import Onboard from "@matterlabs/zk-wallet-onboarding";
import { ethers } from "ethers";

import onboardConfig from "@/plugins/onboardConfig.js";
import web3Wallet from "@/plugins/web3.js";
import utils from "@/plugins/utils";
import { APP_ZKSYNC_API_LINK, ETHER_NETWORK_NAME } from "@/plugins/build";

import { walletData } from "@/plugins/walletData";

let getTransactionHistoryAgain = false;
let changeNetworkWasSet = false;

/**
 * @todo avoid cross-colling
 * @param dispatch
 * @param context
 * @return {function(): Promise<void>}
 */
function changeNetworkHandle(dispatch, context) {
  // context.$toast.info("Blockchain environment (Network) just changed");
  return async () => {
    if (!walletData.get().syncWallet) {
      return;
    }
    const refreshWalletResult = await dispatch("walletRefresh", false);
    if (refreshWalletResult === false) {
      await context.$router.push("/");
      await dispatch("logout");
    } else {
      await dispatch("forceRefreshData");
    }
  };
}

/**
 * @todo avoid cross-colling
 * @param dispatch
 * @param context
 * @return {function(): Promise<void>}
 */
function changeAccountHandle(dispatch, context) {
  // context.$toast.info("Active account changed. Please re-login to used one");
  return async () => {
    if (!walletData.get().syncWallet) {
      return;
    }
    await dispatch("logout");
    await context.$router.push("/");
    await dispatch("clearDataStorage");
  };
}

export const state = () => ({
  onboard: false,
  isAccountLocked: false,
  zkTokens: {
    lastUpdated: 0,
    list: [],
  },
  initialTokens: {
    lastUpdated: 0,
    list: [],
  },
  tokenPrices: {},
  transactionsHistory: {
    lastUpdated: 0,
    list: [],
  },
  withdrawalProcessingTime: false,
  fees: {},
});

export const mutations = {
  setAccountLockedState(state, accountState) {
    state.isAccountLocked = accountState;
  },
  setOnboard(state, obj) {
    state.onboard = obj;
  },
  setTokensList(state, obj) {
    state.initialTokens = obj;
  },
  setZkTokens(state, obj) {
    state.zkTokens = obj;
  },
  setTokenPrice(state, { symbol, obj }) {
    state.tokenPrices[symbol] = obj;
  },
  setTransactionsList(state, obj) {
    state.transactionsHistory = obj;
  },
  setWithdrawalProcessingTime(state, obj) {
    state.withdrawalProcessingTime = obj;
  },
  setFees(state, { symbol, feeSymbol, type, address, obj }) {
    if (!state.fees.hasOwnProperty(symbol)) {
      state.fees[symbol] = {};
    }
    if (!state.fees[symbol].hasOwnProperty(feeSymbol)) {
      state.fees[symbol][feeSymbol] = {};
    }
    if (!state.fees[symbol][feeSymbol].hasOwnProperty(type)) {
      state.fees[symbol][feeSymbol][type] = {};
    }
    state.fees[symbol][feeSymbol][type][address] = obj;
  },
  clearDataStorage(state) {
    state.zkTokens = {
      lastUpdated: 0,
      list: [],
    };
    state.initialTokens = {
      lastUpdated: 0,
      list: [],
    };
    state.transactionsHistory = {
      lastUpdated: 0,
      list: [],
    };
    state.fees = {};
  },
};

export const getters = {
  isAccountLocked(state) {
    return state.isAccountLocked;
  },
  getOnboard(state) {
    return state.onboard;
  },
  getTokensList(state) {
    return state.initialTokens;
  },
  getzkList(state) {
    return state.zkTokens;
  },
  getTokenPrices(state) {
    return state.tokenPrices;
  },
  getTransactionsList(state) {
    return state.transactionsHistory;
  },
  getWithdrawalProcessingTime(state) {
    return state.withdrawalProcessingTime;
  },
  getFees(state) {
    return state.fees;
  },

  getSyncWallet() {
    return walletData.get().syncWallet;
  },

  getProvider() {
    return walletData.get().syncProvider;
  },
  isLoggedIn() {
    console.log(walletData.get().syncWallet);
    if (walletData.get().syncWallet && walletData.get().syncWallet["address"]) {
      return true;
    }
    console.log("not logged in");
    return false;
  },
};

export const actions = {
  /**
   * Initial call, connecting to the wallet
   * @param commit
   * @return {Promise<boolean>}
   */
  async onboard({ commit }) {
    const onboard = Onboard(onboardConfig(this));
    commit("setOnboard", onboard);
    const previouslySelectedWallet = window.localStorage.getItem("selectedWallet");
    if (!previouslySelectedWallet) {
      this.commit("account/setSelectedWallet", "");
      return false;
    } else {
      this.dispatch("toaster/info", "Found previously selected wallet.");
      this.commit("account/setSelectedWallet", previouslySelectedWallet);
    }
    const walletSelect = await onboard.walletSelect(previouslySelectedWallet);
    return walletSelect === true;
  },

  /**
   * Check if the connection to the sync provider is opened and if not - restore it
   */
  async restoreProviderConnection() {
    const syncProvider = walletData.get().syncProvider;
    if (!syncProvider.transport.ws.isOpened) {
      await syncProvider.transport.ws.open();
    }
  },

  /**
   *
   * @param commit
   * @param dispatch
   * @param getters
   * @param accountState
   * @param force
   * @return {Promise<[]|*>}
   */
  async getzkBalances({ commit, dispatch, getters }, { accountState, force = false } = { accountState: undefined, force: false }) {
    let listCommited = {};
    let listVerified = {};
    let tokensList = [];
    let syncWallet = walletData.get().syncWallet;
    if (accountState) {
      listCommited = accountState.committed.balances;
      listVerified = accountState.verified.balances;
    } else {
      const localList = getters["getzkList"];
      if (force === false && localList.lastUpdated > new Date().getTime() - 60000) {
        return localList.list;
      }
      await dispatch("restoreProviderConnection");
      let newAccountState = await syncWallet.getAccountState();

      // @todo Left for testing purposes.
      // const testBalances = {
      //   DAI: 98.91346,
      //   ETH: 0.00697466,
      //   STORJ: 10.496,
      //   USDC: 3329.78057,
      //   USDT: 98.55857,
      // };
      // // const testBalances1 = {
      // //   BAT: 0.9,
      // //   DAI: 33543.4016421191,
      // //   ETH: 0.0028442766686,
      // //   KNC: 0.8,
      // //   USDT: 64.277,
      // // }
      // newAccountState["committed"]["balances"] = testBalances;
      // newAccountState["verified"]["balances"] = testBalances;
      // console.log(newAccountState);

      walletData.set({ accountState: newAccountState });
      listCommited = newAccountState.committed.balances;
      listVerified = newAccountState.verified.balances;
    }
    const restrictedTokens = this.getters["tokens/getRestrictedTokens"];

    for (const tokenSymbol in listCommited) {
      const price = await this.dispatch("tokens/getTokenPrice", tokenSymbol);
      const commitedBalance = +utils.handleFormatToken(tokenSymbol, listCommited[tokenSymbol] ? listCommited[tokenSymbol] : 0);
      const verifiedBalance = +utils.handleFormatToken(tokenSymbol, listVerified[tokenSymbol] ? listVerified[tokenSymbol] : 0);
      tokensList.push({
        symbol: tokenSymbol,
        status: commitedBalance !== verifiedBalance ? "Pending" : "Verified",
        balance: commitedBalance,
        formatedBalance: commitedBalance.toFixed(7),
        verifiedBalance: verifiedBalance,
        tokenPrice: price,
        formatedTotalPrice: utils.getFormatedTotalPrice(price, commitedBalance),
        restricted: (commitedBalance <= 0 || restrictedTokens.hasOwnProperty(tokenSymbol)) === true,
      });
    }
    tokensList.sort(utils.sortBalancesById);
    commit("setZkTokens", {
      lastUpdated: new Date().getTime(),
      list: tokensList,
    });
    return tokensList;
  },

  /**
   *
   * @param dispatch
   * @param commit
   * @param getters
   * @param force
   * @return {Promise<*[]|*>}
   */
  async getInitialBalances({ dispatch, commit, getters }, force = false) {
    const localList = getters["getTokensList"];

    if (force === false && localList.lastUpdated > new Date().getTime() - 60000) {
      return localList.list;
    }
    await dispatch("restoreProviderConnection");
    const syncWallet = walletData.get().syncWallet;
    const accountState = await syncWallet.getAccountState();
    walletData.set({ accountState });
    const loadedTokens = await this.dispatch("tokens/loadTokensAndBalances");

    const loadInitialBalancesPromises = Object.keys(loadedTokens.tokens).map(async (key) => {
      const currentToken = loadedTokens.tokens[key];
      try {
        let balance = await syncWallet.getEthereumBalance(key);
        balance = +utils.handleFormatToken(currentToken.symbol, balance ? balance : 0);
        return {
          id: currentToken.id,
          address: currentToken.address,
          balance: balance,
          formatedBalance: balance.toFixed(7),
          symbol: currentToken.symbol,
        };
      } catch (error) {
        this.dispatch("toaster/error", `Error getting ${currentToken.symbol} balance`);
        console.log(error.message);
        return {
          id: currentToken.id,
          address: currentToken.address,
          balance: balance,
          formatedBalance: 0,
          symbol: currentToken.symbol,
        };
      }
    });
    const balancesResults = await Promise.all(loadInitialBalancesPromises).catch((err) => {
      return [];
    });
    const balances = balancesResults.filter((token) => token && token.balance > 0).sort(utils.sortBalancesById);
    const balancesEmpty = balancesResults.filter((token) => token && token.balance === 0).sort(utils.sortBalancesById);
    balances.push(...balancesEmpty);
    commit("setTokensList", {
      lastUpdated: new Date().getTime(),
      list: balances,
    });
    return balances;
  },

  /**
   *
   * @param dispatch
   * @param commit
   * @param getters
   * @param options
   * @return {Promise<any>}
   */
  async getTransactionsHistory({ dispatch, commit, getters }, options) {
    clearTimeout(getTransactionHistoryAgain);
    const localList = getters["getTransactionsList"];
    if (!options) {
      options = {
        force: false,
        offset: 0,
      };
    } else {
      if (options.force === undefined) {
        options.force = false;
      }
      if (options.offset === undefined) {
        options.offset = 0;
      }
    }
    if (options.force === false && localList.lastUpdated > new Date().getTime() - 30000 && options.offset === 0) {
      return localList.list;
    }
    try {
      const syncWallet = walletData.get().syncWallet;
      const fetchTransactionHistory = await this.$axios.get(`https://${APP_ZKSYNC_API_LINK}/api/v0.1/account/${syncWallet.address()}/history/${options.offset}/25`);
      commit("setTransactionsList", {
        lastUpdated: new Date().getTime(),
        list: options.offset === 0 ? fetchTransactionHistory.data : [...localList.list, ...fetchTransactionHistory.data],
      });
      return fetchTransactionHistory.data;
    } catch (error) {
      this.dispatch("toaster/error", error.message);
      getTransactionHistoryAgain = setTimeout(() => {
        dispatch("getTransactionsHistory", true);
      }, 15000);
      return localList.list;
    }
  },
  async getWithdrawalProcessingTime({ getters, commit }) {
    if (getters["getWithdrawalProcessingTime"]) {
      return getters["getWithdrawalProcessingTime"];
    } else {
      const withdrawTime = await this.$axios.get(`https://${APP_ZKSYNC_API_LINK}/api/v0.1/withdrawal_processing_time`);
      commit("setWithdrawalProcessingTime", withdrawTime.data);
      return withdrawTime.data;
    }
  },
  async getFees({ getters, commit, dispatch }, { address, symbol, feeSymbol, type }) {
    const savedFees = getters["getFees"];
    if (
      savedFees &&
      savedFees.hasOwnProperty(symbol) &&
      savedFees[symbol].hasOwnProperty(feeSymbol) &&
      savedFees[symbol][feeSymbol].hasOwnProperty(type) &&
      savedFees[symbol][feeSymbol][type].hasOwnProperty(address)
    ) {
      return savedFees[symbol][feeSymbol][type][address];
    } else {
      const syncProvider = walletData.get().syncProvider;
      const syncWallet = walletData.get().syncWallet;
      await dispatch("restoreProviderConnection");
      const zksync = await walletData.zkSync();
      if (type === "withdraw") {
        if (symbol === feeSymbol) {
          const foundFeeFast = await syncProvider.getTransactionFee("FastWithdraw", address, symbol);
          const foundFeeNormal = await syncProvider.getTransactionFee("Withdraw", address, symbol);
          const feesObj = {
            fast: +utils.handleFormatToken(symbol, zksync.closestPackableTransactionFee(foundFeeFast.totalFee.toString())),
            normal: +utils.handleFormatToken(symbol, zksync.closestPackableTransactionFee(foundFeeNormal.totalFee.toString())),
          };
          commit("setFees", { symbol, feeSymbol, type, address, obj: feesObj });
          return feesObj;
        } else {
          const batchWithdrawFeeFast = await syncProvider.getTransactionsBatchFee(["FastWithdraw", "Transfer"], [address, syncWallet.address()], feeSymbol);
          const batchWithdrawFeeNormal = await syncProvider.getTransactionsBatchFee(["Withdraw", "Transfer"], [address, syncWallet.address()], feeSymbol);
          const feesObj = {
            fast: +utils.handleFormatToken(feeSymbol, zksync.closestPackableTransactionFee(batchWithdrawFeeFast.toString())),
            normal: +utils.handleFormatToken(feeSymbol, zksync.closestPackableTransactionFee(batchWithdrawFeeNormal.toString())),
          };
          commit("setFees", { symbol, feeSymbol, type, address, obj: feesObj });
          return feesObj;
        }
      } else {
        if (symbol === feeSymbol) {
          const foundFeeNormal = await syncProvider.getTransactionFee("Transfer", address, symbol);
          const totalFeeValue = +utils.handleFormatToken(symbol, zksync.closestPackableTransactionFee(foundFeeNormal.totalFee.toString()));
          const feesObj = {
            normal: totalFeeValue,
          };
          commit("setFees", { symbol, feeSymbol, type, address, obj: feesObj });
          return feesObj;
        } else {
          const batchTransferFee = await syncProvider.getTransactionsBatchFee(["Transfer", "Transfer"], [address, syncWallet.address()], feeSymbol);
          const feesObj = {
            normal: +utils.handleFormatToken(feeSymbol, zksync.closestPackableTransactionFee(batchTransferFee.toString())),
          };
          commit("setFees", { symbol, feeSymbol, type, address, obj: feesObj });
          return feesObj;
        }
      }
    }
  },

  async checkLockedState({ commit }) {
    const syncWallet = walletData.get().syncWallet;
    const isSigningKeySet = await syncWallet.isSigningKeySet();
    commit("setAccountLockedState", isSigningKeySet === false);
  },

  async walletRefresh({ getters, commit, dispatch }, firstSelect = true) {
    try {
      /* dispatch("changeNetworkRemove"); */
      const onboard = getters["getOnboard"];
      this.commit("account/setLoadingHint", "followInstructions");
      let walletCheck = false;
      if (firstSelect === true) {
        walletCheck = await onboard.walletSelect();
        if (walletCheck !== true) {
          return false;
        }
        walletCheck = await onboard.walletCheck();
      } else {
        walletCheck = await onboard.walletCheck();
      }
      if (walletCheck !== true) {
        return false;
      }
      if (!web3Wallet.get().eth) {
        return false;
      }
      const getAccounts = await web3Wallet.get().eth.getAccounts();
      if (getAccounts.length === 0) {
        return false;
      }
      if (walletData.get().syncWallet) {
        this.commit("account/setAddress", walletData.get().syncWallet.address());
        this.commit("account/setLoggedIn", true);
        return true;
      }

      /**
       * @type {provider|ExternalProvider}
       */
      const currentProvider = web3Wallet.get().eth.currentProvider;
      const ethWallet = new ethers.providers.Web3Provider(currentProvider).getSigner();

      const zksync = await walletData.zkSync();
      const syncProvider = await zksync.getDefaultProvider(ETHER_NETWORK_NAME);
      const syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);

      this.commit("account/setLoadingHint", "loadingData");
      const accountState = await syncWallet.getAccountState();

      walletData.set({ syncProvider, syncWallet, accountState, ethWallet });

      await this.dispatch("tokens/loadTokensAndBalances");
      await dispatch("getzkBalances", accountState);

      await dispatch("checkLockedState");

      dispatch("changeNetworkSet");
      this.commit("account/setAddress", syncWallet.address());
      this.commit("account/setLoggedIn", true);
      return true;
    } catch (error) {
      this.dispatch("toaster/error", `Refreshing state of the wallet failed... Reason: ${error.message}`);
      console.log("Refresh error", error);
      return false;
    }
  },
  async clearDataStorage({ commit }) {
    commit("clearDataStorage");
  },
  async forceRefreshData({ dispatch }) {
    await dispatch("getInitialBalances", true).catch((err) => {
      console.log("forceRefreshData | getInitialBalances error", err);
    });
    await dispatch("getzkBalances", { accountState: undefined, force: true }).catch((err) => {
      console.log("forceRefreshData | getzkBalances error", err);
    });
    await dispatch("getTransactionsHistory", { force: true }).catch((err) => {
      console.log("forceRefreshData | getTransactionsHistory error", err);
    });
  },
  async logout({ dispatch, commit, getters }) {
    const onboard = getters["getOnboard"];
    onboard.walletReset();
    walletData.set({ syncProvider: null, syncWallet: null, accountState: null });
    localStorage.removeItem("selectedWallet");
    this.commit("account/setLoggedIn", false);
    this.commit("account/setSelectedWallet", "");
    commit("clearDataStorage");
  },
  /**
   * @todo deprecated in favour of event-bus
   * @param dispatch
   * @return {Promise<void>}
   */
  async changeNetworkSet({ dispatch }) {
    if (changeNetworkWasSet === true) {
      return;
    }
    if (process.client && window.ethereum) {
      changeNetworkWasSet = true;
      window.ethereum.on("disconnect", () => {
        dispatch("toaster/error", "Connection with your Wallet was lost. Restarting the DAPP", { root: true });
        dispatch("logout");
      });
      window.ethereum.on("chainChanged", changeNetworkHandle(dispatch, this));
      window.ethereum.on("accountsChanged", changeAccountHandle(dispatch, this));
    }
  },
};