// ==UserScript==
// @name        Wealthsimple export transactions as OFX
// @namespace   Violentmonkey Scripts
// @match       https://my.wealthsimple.com/*
// @grant       GM.xmlHttpRequest
// @version     1.0
// @license     MIT
// @author      Peter Kieser
// @description Adds export buttons to Activity feed and to Account specific activity. They will export transactions within certain timeframe into OFX, options are "This Month", "Last 3 Month", "All". This should provide better transaction description than what is provided by preexisting CSV export feature.
// ==/UserScript==

/**
 * @callback ReadyPredicate
 * @returns {boolean}
 */

/**
 * @typedef {Object} PageInfo
 * @property {"account-details" | "activity" | null} pageType
 * @property {HTMLElement?} anchor - Element to which buttons will be "attached". Buttons should be inserted before it.
 * @property {ReadyPredicate?} readyPredicate - Verifies if ready to insert
 */

/**
 * Figures out which paget we're currently on and where to attach buttons. Should not do any queries,
 * because it gets spammed executed by MutationObserver.
 *
 * @returns {PageInfo}
 */
function getPageInfo() {
    /**
     * @type PageInfo
     */
    let emptyInfo = {
        pageType: null,
        anchor: null,
        readyPredicate: null,
        accountsInfo: null,
    };
    let info = structuredClone(emptyInfo);

    let pathParts = window.location.pathname.split("/");
    if (pathParts.length === 4 && pathParts[2] === "account-details") {
        // All classes within HTML have been obfuscated/minified, using icons as a starting point, in hope that they don't change that much.
        const accountSelectorQuery = `div:has(> div > button svg > path[d="M5.363 3.363a.9.9 0 0 1 1.274 0l4 4a.9.9 0 0 1 0 1.274l-4 4a.9.9 0 0 1-1.274-1.274L8.727 8 5.363 4.637a.9.9 0 0 1 0-1.274Z"])`;
        info.pageType = "account-details";
        let anchor = document.querySelectorAll(accountSelectorQuery);
        if (anchor.length !== 1) {
            return emptyInfo;
        }
        info.anchor = anchor[0];
        info.readyPredicate = () => info.anchor.parentNode.children.length >= 1;
    } else if (pathParts.length === 3 && pathParts[2] === "activity") {
        info.pageType = "activity";
        let anchor = Array.from(document.querySelectorAll(`h1`)).find(el => el.textContent === "Activity");
        if (anchor === undefined) {
            return emptyInfo;
        }
        info.anchor = anchor;
        info.readyPredicate = () => info.anchor.parentNode.children.length >= 1;
    } else {
        // Didn't match any expected page
        return emptyInfo;
    }
    return info;
}

// ID for quickly verifying if buttons were already injected
const exportCsvId = "export-transactions-csv";

/**
 * Keeps button shown after rerenders and href changes
 *
 * @returns {void}
 */
function keepButtonShown() {
    // Early exit, to avoid unnecessary requests if already injected
    if (document.querySelector(`div#${exportCsvId}`)) {
        return;
    }

    const pageInfo = getPageInfo();
    if (!pageInfo.pageType) {
        return;
    }
    if (!pageInfo.readyPredicate || !pageInfo.readyPredicate()) {
        return;
    }

    console.log("[csv-export] Adding buttons");
    addButtons(pageInfo);
}

(async function () {
    const observer = new MutationObserver(async (mutations) => {
        for (const _ of mutations) {
            keepButtonShown();
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    window.matchMedia("(prefers-color-scheme: dark)").addListener(async e => {
        // Give react / whatever weird frontend framework time to update classes before copying them
        await new Promise(res => setTimeout(res, 100));
        themeButtons();
    });

    // Try running on load if there are no mutations for some reason
    window.addEventListener("load", async () => {
        keepButtonShown();
    });
})();

/**
 * Matches light/dark theme by stealing styling from profile settings dropdown button
 */
function themeButtons() {
    let buttons = document.querySelectorAll(`button.export-csv-button`);
    let profileButton = document.querySelector(`button:has(svg > path[d="M12 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"])`);
    for (const button of buttons) {
        button.className = ["export-csv-button", profileButton.className].join(" ");
    }
}

/**
 * Attaches button row to anchor element. Should be syncronous to avoid attaching row twice, because Mutex is not cool enough for JS?
 *
 * @param {PageInfo} pageInfo
 * @returns {void}
 */
function addButtons(pageInfo) {
    let buttonRow = document.createElement("div");
    buttonRow.id = exportCsvId;
    buttonRow.style.display = "flex";
    buttonRow.style.alignItems = "baseline";
    buttonRow.style.gap = "1em";
    buttonRow.style.marginLeft = "auto";

    let buttonRowText = document.createElement("span");
    buttonRowText.innerText = "Export Transactions as OFX:"; // Changed to OFX
    buttonRow.appendChild(buttonRowText);

    const now = new Date();
    const buttons = [
        {
            text: "Last 2 Weeks",
            fromDate: new Date(new Date() - 1000 * 60 * 60 * 24 * 14),
        },
        {
            text: "This Month",
            fromDate: new Date(now.getFullYear(), now.getMonth(), 1),
        },
        {
            text: "All",
            fromDate: null,
        },
    ];

    for (const button of buttons) {
        let exportButton = document.createElement("button");
        exportButton.innerText = button.text;
        exportButton.className = "export-csv-button";
        exportButton.onclick = async () => {
            console.log("[ofx-export] Fetching account details"); // Changed log prefix
            let accountsInfo = await accountFinancials();
            let accountNicknames = accountsInfo.reduce((acc, v) => {
                acc[v.id] = v.nickname;
                return acc;
            }, {});

            let transactions = [];
            let accountIds;
            console.log("[ofx-export] Fetching transactions");

            if (pageInfo.pageType === "account-details") {
                let pathParts = window.location.pathname.split("/");
                accountIds = [pathParts[3]];
                transactions = await activityList(accountIds, button.fromDate);
            } else if (pageInfo.pageType === "activity") {
                let params = new URLSearchParams(window.location.search);
                let ids_param = params.get("account_ids");
                if (ids_param) {
                    accountIds = ids_param.split(",");
                } else {
                    accountIds = accountsInfo.map((acc) => acc.id);
                }
                transactions = await activityFeedItems(accountIds, button.fromDate);
            }

            let blobs = await transactionsToOfxBlobs(transactions, accountNicknames); // Changed function name
            saveBlobsToFiles(blobs, accountsInfo, button.fromDate);
        };

        buttonRow.appendChild(exportButton);
    }

    pageInfo.anchor.after(buttonRow);
    pageInfo.anchor.parentNode.style.gap = "1em";
    pageInfo.anchor.style.marginLeft = "0";

    themeButtons();
}

/**
 * @typedef {Object} OauthCookie
 * @property {string} access_token
 * @property {string} identity_canonical_id
 */

/**
 * @returns {OauthCookie}
 */
function getOauthCookie() {
    let decodedCookie = decodeURIComponent(document.cookie).split(";");
    for (let cookieKV of decodedCookie) {
        if (cookieKV.indexOf("_oauth2_access_v2") !== -1) {
            let [_, val] = cookieKV.split("=");
            return JSON.parse(val);
        }
    }
    return null;
}

/**
 * Subset of ActivityFeedItem type in GraphQL API
 *
 * @typedef {Object} Transaction
 * @property {string} accountId
 * @property {string} externalCanonicalId
 * @property {string} amount
 * @property {string} amountSign
 * @property {string} occurredAt
 * @property {string} type
 * @property {string} subType
 * @property {string?} eTransferEmail
 * @property {string?} eTransferName
 * @property {string?} assetSymbol
 * @property {string?} assetQuantity
 * @property {string?} aftOriginatorName
 * @property {string?} aftTransactionCategory
 * @property {string?} opposingAccountId
 * @property {string?} spendMerchant
 * @property {string?} billPayCompanyName
 * @property {string?} billPayPayeeNickname
 */

const activityFeedItemFragment = `
      fragment Activity on ActivityFeedItem {
        accountId
        externalCanonicalId
        amount
        amountSign
        occurredAt
        type
        subType
        eTransferEmail
        eTransferName
        assetSymbol
        assetQuantity
        aftOriginatorName
        aftTransactionCategory
        aftTransactionType
        canonicalId
        currency
        identityId
        institutionName
        p2pHandle
        p2pMessage
        spendMerchant
        securityId
        billPayCompanyName
        billPayPayeeNickname
        redactedExternalAccountNumber
        opposingAccountId
        status
        strikePrice
        contractType
        expiryDate
        chequeNumber
        provisionalCreditAmount
        primaryBlocker
        interestRate
        frequency
        counterAssetSymbol
        rewardProgram
        counterPartyCurrency
        counterPartyCurrencyAmount
        counterPartyName
        fxRate
        fees
        reference
      }
    `;

const fetchActivityListQuery = `
      query FetchActivityList(
        $first: Int!
        $cursor: Cursor
        $accountIds: [String!]
        $types: [ActivityFeedItemType!]
        $subTypes: [ActivityFeedItemSubType!]
        $endDate: Datetime
        $securityIds: [String]
        $startDate: Datetime
        $legacyStatuses: [String]
      ) {
        activities(
          first: $first
          after: $cursor
          accountIds: $accountIds
          types: $types
          subTypes: $subTypes
          endDate: $endDate
          securityIds: $securityIds
          startDate: $startDate
          legacyStatuses: $legacyStatuses
        ) {
          edges {
            node {
              ...Activity
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

/**
 * API used by account specific activity view.
 * Seems like it's just outdated API, will use it just as safetyguard
 *
 * @returns {Promise<[Transaction]>}
 */
async function activityList(accountIds, startDate) {
    let transactions = [];
    let hasNextPage = true;
    let cursor = undefined;
    while (hasNextPage) {
        let respJson = await GM.xmlHttpRequest({
            url: "https://my.wealthsimple.com/graphql",
            method: "POST",
            responseType: "json",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${getOauthCookie().access_token}`,
            },
            data: JSON.stringify({
                operationName: "FetchActivityList",
                query: `
                ${fetchActivityListQuery}
                ${activityFeedItemFragment}
            `,
                variables: {
                    first: 100,
                    cursor,
                    startDate,
                    endDate: new Date().toISOString(),
                    accountIds,
                },
            }),
        });

        if (respJson.status !== 200) {
            throw `Failed to fetch transactions: ${respJson.responseText}`;
        }
        let resp = JSON.parse(respJson.responseText);
        let activities = resp.data.activities;
        hasNextPage = activities.pageInfo.hasNextPage;
        cursor = activities.pageInfo.endCursor;
        transactions = transactions.concat(activities.edges.map((e) => e.node));
    }
    return transactions;
}

const fetchActivityFeedItemsQuery = `
      query FetchActivityFeedItems(
        $first: Int
        $cursor: Cursor
        $condition: ActivityCondition
        $orderBy: [ActivitiesOrderBy!] = OCCURRED_AT_DESC
      ) {
        activityFeedItems(
          first: $first
          after: $cursor
          condition: $condition
          orderBy: $orderBy
        ) {
          edges {
            node {
              ...Activity
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

/**
 * API used by activity feed page.
 * @returns {Promise<[Transaction]>}
 */
async function activityFeedItems(accountIds, startDate) {
    let transactions = [];
    let hasNextPage = true;
    let cursor = undefined;
    while (hasNextPage) {
        let respJson = await GM.xmlHttpRequest({
            url: "https://my.wealthsimple.com/graphql",
            method: "POST",
            responseType: "json",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${getOauthCookie().access_token}`,
            },
            data: JSON.stringify({
                operationName: "FetchActivityFeedItems",
                query: `
                ${fetchActivityFeedItemsQuery}
                ${activityFeedItemFragment}
            `,
                variables: {
                    first: 100,
                    cursor,
                    condition: {
                        startDate,
                        accountIds,
                        unifiedStatuses: ["COMPLETED"],
                    },
                },
            }),
        });

        if (respJson.status !== 200) {
            throw `Failed to fetch transactions: ${respJson.responseText}`;
        }
        let resp = JSON.parse(respJson.responseText);
        let activities = resp.data.activityFeedItems;
        hasNextPage = activities.pageInfo.hasNextPage;
        cursor = activities.pageInfo.endCursor;
        transactions = transactions.concat(activities.edges.map((e) => e.node));
    }
    return transactions;
}

const fetchAllAccountFinancialsQuery = `
      query FetchAllAccountFinancials(
        $identityId: ID!
        $pageSize: Int = 25
        $cursor: String
      ) {
        identity(id: $identityId) {
          id
          accounts(filter: {}, first: $pageSize, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              cursor
              node {
                ...Account
              }
            }
          }
        }
      }

      fragment Account on Account {
        id
        unifiedAccountType
        nickname
      }
    `;

/**
 * @typedef {Object} AccountInfo
 * @property {string} id
 * @property {string} nickname
 */

/**
 * Query all accounts
 * @returns {Promise<[AccountInfo]>}
 */
async function accountFinancials() {
    let oauthCookie = getOauthCookie();
    let respJson = await GM.xmlHttpRequest({
        url: "https://my.wealthsimple.com/graphql",
        method: "POST",
        responseType: "json",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${oauthCookie.access_token}`,
        },
        data: JSON.stringify({
            operationName: "FetchAllAccountFinancials",
            query: fetchAllAccountFinancialsQuery,
            variables: {
                identityId: oauthCookie.identity_canonical_id,
                pageSize: 25,
            },
        }),
    });

    if (respJson.status !== 200) {
        throw `Failed to fetch account info: ${respJson.responseText}`;
    }
    let resp = JSON.parse(respJson.responseText);
    const self_directed_re = /^SELF_DIRECTED_(?<name>.*)/;
    let accounts = resp.data.identity.accounts.edges.map((e) => {
        let nickname = e.node.nickname;
        if (!nickname) {
            if (e.node.unifiedAccountType === "CASH") {
                nickname = "Cash";
            } else if (e.node.unifiedAccountType === "CREDIT_CARD") {
                nickname = "Credit Card";
            } else if (self_directed_re.test(e.node.unifiedAccountType)) {
                let found = e.node.unifiedAccountType.match(self_directed_re);
                nickname = found.groups.name;
                if (nickname === "CRYPTO") {
                    nickname = "Crypto";
                } else if (nickname === "NON_REGISTERED") {
                    nickname = "Non-registered";
                }
            } else {
                nickname = "Unknown";
            }
        }
        return {
            id: e.node.id,
            nickname,
        };
    });
    return accounts;
}

/**
 * @typedef {Object} TransferInfo
 * @property {string} id
 * @property {string} status
 * @property {{"bankAccount": BankInfo}} source
 * @property {{"bankAccount": BankInfo}} destination
 */

/**
 * @typedef {Object} BankInfo
 * @property {string} accountName
 * @property {string} accountNumber
 * @property {string} institutionName
 * @property {string} nickname
 */

const fetchFundsTransferQuery = `
      query FetchFundsTransfer($id: ID!) {
        fundsTransfer: funds_transfer(id: $id, include_cancelled: true) {
          id
          status
          source {
            ...BankAccountOwner
          }
          destination {
            ...BankAccountOwner
          }
        }
      }

      fragment BankAccountOwner on BankAccountOwner {
        bankAccount: bank_account {
          id
          institutionName: institution_name
          nickname
          ...CaBankAccount
          ...UsBankAccount
        }
      }

      fragment CaBankAccount on CaBankAccount {
        accountName: account_name
        accountNumber: account_number
      }

      fragment UsBankAccount on UsBankAccount {
        accountName: account_name
        accountNumber: account_number
      }
    `;

/**
 * @param {string} transferId
 * @returns {Promise<TransferInfo>}
 */
async function fundsTransfer(transferId) {
    let respJson = await GM.xmlHttpRequest({
        url: "https://my.wealthsimple.com/graphql",
        method: "POST",
        responseType: "json",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${getOauthCookie().access_token}`,
        },
        data: JSON.stringify({
            operationName: "FetchFundsTransfer",
            query: fetchFundsTransferQuery,
            variables: {
                id: transferId,
            },
        }),
    });

    if (respJson.status !== 200) {
        throw `Failed to fetch transfer info: ${respJson.responseText}`;
    }
    let resp = JSON.parse(respJson.responseText);
    return resp.data.fundsTransfer;
}

/**
 * Formats date for OFX format (YYYYMMDDHHMMSS)
 * @param {Date} date
 * @returns {string}
 */
function formatOfxDate(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}000000`;
}

/**
 * Escapes XML special characters
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * @param {[Transaction]} transactions
 * @param {{[string]: string}} accountNicknames
 * @returns {Promise<{[string]: Blob}>}
 */
async function transactionsToOfxBlobs(transactions, accountNicknames) {
    // Get full account info
    let accountsInfo = await accountFinancials();
    let accountTypeMap = accountsInfo.reduce((acc, v) => {
        acc[v.id] = v.unifiedAccountType;
        return acc;
    }, {});

    let accTransactions = transactions.reduce((acc, transaction) => {
        const id = transaction.accountId;
        (acc[id] = acc[id] || []).push(transaction);
        return acc;
    }, {});

    let accBlobs = {};
    for (let acc in accTransactions) {
        // Determine account type from transactions themselves
        let accountType = accountTypeMap[acc];

        // Check if any transaction in this account is a credit card transaction
        const hasCreditCardTransactions = accTransactions[acc].some(t =>
            t.type === "CREDIT_CARD" || (t.type && t.type.startsWith("CREDIT_CARD"))
        );

        if (hasCreditCardTransactions) {
            accountType = "CREDIT_CARD"; // Override with credit card type
        }

        accBlobs[acc] = await accountTransactionsToOfxBlob(
            accTransactions[acc],
            accountNicknames,
            acc,
            accountNicknames[acc],
            accountType
        );
    }
    return accBlobs;
}

/**
 * Maps account types to OFX account types
 * @param {string} accountType
 * @param {[Transaction]} transactions
 * @returns {string}
 */
function determineOfxAccountType(accountType, transactions) {
    // First check if any transactions indicate this is a credit card account
    const hasCreditCardTransactions = transactions && transactions.some(t =>
        t.type === "CREDIT_CARD" || (t.type && t.type.startsWith("CREDIT_CARD"))
    );

    if (hasCreditCardTransactions) {
        return "CREDITCARD";
    }

    // Otherwise use the account type mapping
    return mapToOfxAccountType(accountType);
}


/**
 * Maps Wealthsimple account types to OFX account types
 * @param {string} wsAccountType
 * @returns {string}
 */
function mapToOfxAccountType(wsAccountType) {
    // OFX account types: CHECKING, SAVINGS, MONEYMRKT, CREDITLINE, CREDITCARD, INVESTMENT

    if (!wsAccountType) {
        return "CHECKING";
    }

    // Map Wealthsimple account types to OFX types
    const typeMap = {
        "CASH": "CHECKING",
        "CHEQUING": "CHECKING",
        "SAVINGS": "SAVINGS",
        "CREDIT_CARD": "CREDITCARD",
        "SELF_DIRECTED_CRYPTO": "INVESTMENT",
        "SELF_DIRECTED_NON_REGISTERED": "INVESTMENT",
        "SELF_DIRECTED_TFSA": "INVESTMENT",
        "SELF_DIRECTED_RRSP": "INVESTMENT",
        "SELF_DIRECTED_RESP": "INVESTMENT",
        "SELF_DIRECTED_RRIF": "INVESTMENT",
        "SELF_DIRECTED_FHSA": "INVESTMENT",
        "SELF_DIRECTED_LIRA": "INVESTMENT",
        "MANAGED_TFSA": "INVESTMENT",
        "MANAGED_RRSP": "INVESTMENT",
        "MANAGED_RESP": "INVESTMENT",
        "MANAGED_RRIF": "INVESTMENT",
        "MANAGED_NON_REGISTERED": "INVESTMENT"
    };

    // Check for exact match first
    if (typeMap[wsAccountType]) {
        return typeMap[wsAccountType];
    }

    // Check if it contains certain keywords
    if (wsAccountType.includes("SELF_DIRECTED") || wsAccountType.includes("MANAGED")) {
        return "INVESTMENT";
    }

    if (wsAccountType.includes("CREDIT")) {
        return "CREDITCARD";
    }

    if (wsAccountType.includes("SAVING")) {
        return "SAVINGS";
    }

    // Default to checking
    return "CHECKING";
}
/**
 * @param {[Transaction]} transactions
 * @param {{[string]: string}} accountNicknames
 * @param {string} accountId
 * @param {string} accountName
 * @param {string} accountType
 * @returns {Promise<Blob>}
 */
async function accountTransactionsToOfxBlob(transactions, accountNicknames, accountId, accountName, accountType) {
    const now = new Date();
    const nowStr = formatOfxDate(now);

    // Determine OFX account type based on both account type and transaction types
    const ofxAccountType = determineOfxAccountType(accountType, transactions);

    // Determine if this is a credit card account
    const isCreditCard = ofxAccountType === "CREDITCARD";

    // Sort transactions by date
    transactions.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

    // Calculate date range
    const startDate = transactions.length > 0 ? formatOfxDate(new Date(transactions[0].occurredAt)) : nowStr;
    const endDate = transactions.length > 0 ? formatOfxDate(new Date(transactions[transactions.length - 1].occurredAt)) : nowStr;

    // Start building OFX - header section
    let ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:UTF-8
CHARSET:UTF-8
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${nowStr}
<LANGUAGE>ENG
<FI>
<ORG>Wealthsimple
<FID>0
</FI>
</SONRS>
</SIGNONMSGSRSV1>
`;

    // Use appropriate message set based on account type
    if (isCreditCard) {
        ofx += `<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>${Date.now()}
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<CCSTMTRS>
<CURDEF>CAD
<CCACCTFROM>
<ACCTID>${escapeXml(accountId)}
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>${startDate}
<DTEND>${endDate}
`;
    } else if (ofxAccountType === "INVESTMENT") {
        // For investment accounts, use INVSTMTMSGSRSV1
        ofx += `<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>${Date.now()}
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<INVSTMTRS>
<DTASOF>${nowStr}
<CURDEF>CAD
<INVACCTFROM>
<BROKERID>Wealthsimple
<ACCTID>${escapeXml(accountId)}
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>${startDate}
<DTEND>${endDate}
`;
    } else {
        // Regular bank accounts
        ofx += `<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>${Date.now()}
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>CAD
<BANKACCTFROM>
<BANKID>Wealthsimple
<ACCTID>${escapeXml(accountId)}
<ACCTTYPE>${ofxAccountType}
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${startDate}
<DTEND>${endDate}
`;
    }

    // Process each transaction (rest of the function remains the same)
    for (const transaction of transactions) {
        let date = new Date(transaction.occurredAt);
        let dateStr = formatOfxDate(date);

        let payee = "";
        let memo = "";
        let trnType = "OTHER"; // OFX transaction type

        let type = transaction.type;
        if (transaction.subType) {
            type = `${type}/${transaction.subType}`;
        }

        // Determine OFX transaction type and details
        switch (type) {
            case "INTEREST": {
                payee = "Wealthsimple";
                memo = "Interest";
                trnType = "INT";
                break;
            }
            case "INTEREST/FPL_INTEREST": {
                payee = "Wealthsimple";
                memo = "Interest";
                trnType = "INT";
                break;
            }
            case "REIMBURSEMENT/ATM": {
                payee = "Wealthsimple";
                memo = "ATM Reimbursement";
                trnType = "CREDIT";
                break;
            }
            case "REIMBURSEMENT/CASHBACK": {
                payee = "Wealthsimple";
                memo = "Cash back";
                trnType = "CREDIT";
                break;
            }
            case "P2P_PAYMENT/SEND": {
                payee = transaction.p2pHandle;
                memo = "P2P Payment";
                trnType = "XFER";
                break;
            }
            case "DEPOSIT/E_TRANSFER": {
                payee = transaction.eTransferEmail;
                memo = `INTERAC e-Transfer from ${transaction.eTransferName}`;
                trnType = "XFER";
                break;
            }
            case "WITHDRAWAL/E_TRANSFER": {
                payee = transaction.eTransferEmail;
                memo = `INTERAC e-Transfer to ${transaction.eTransferName}`;
                trnType = "XFER";
                break;
            }
            case "DIVIDEND/DIY_DIVIDEND": {
                payee = transaction.assetSymbol;
                memo = `Received dividend from ${transaction.assetSymbol}`;
                trnType = "DIV";
                break;
            }
            case "CREDIT_CARD/PURCHASE":
            case "CREDIT_CARD/REFUND": {
                payee = transaction.spendMerchant;
                memo = "";
                trnType = "POS";
                break;
            }
            case "CREDIT_CARD/PAYMENT": {
                payee = "Wealthsimple";
                memo = "";
                trnType = "PAYMENT";
                break;
            }
            case "CREDIT_CARD_PAYMENT": {
                payee = "Wealthsimple";
                memo = "";
                trnType = "PAYMENT";
                break;
            }
            case "DIY_BUY/DIVIDEND_REINVESTMENT": {
                payee = transaction.assetSymbol;
                memo = `Reinvested dividend into ${transaction.assetQuantity} ${transaction.assetSymbol}`;
                trnType = "DEBIT";
                break;
            }
            case "DIY_BUY/MARKET_ORDER":
            case "DIY_BUY/RECURRING_ORDER":
            case "DIY_BUY/LIMIT_ORDER":
            case "DIY_BUY/FRACTIONAL_ORDER": {
                payee = transaction.assetSymbol;
                memo = `Bought ${transaction.assetQuantity} ${transaction.assetSymbol}`;
                trnType = "DEBIT";
                break;
            }
            case "DIY_SELL/MARKET_ORDER":
            case "DIY_SELL/LIMIT_ORDER":
            case "DIY_SELL/FRACTIONAL_ORDER": {
                payee = transaction.assetSymbol;
                memo = `Sold ${transaction.assetQuantity} ${transaction.assetSymbol}`;
                trnType = "CREDIT";
                break;
            }
            case "CRYPTO_BUY/MARKET_ORDER":
            case "CRYPTO_BUY/RECURRING_ORDER":
            case "CRYPTO_BUY/LIMIT_ORDER":
            case "CRYPTO_BUY/FRACTIONAL_ORDER": {
                payee = transaction.assetSymbol;
                memo = `Bought ${transaction.assetQuantity} ${transaction.assetSymbol}`;
                trnType = "DEBIT";
                break;
            }
            case "CRYPTO_SELL/MARKET_ORDER":
            case "CRYPTO_SELL/LIMIT_ORDER":
            case "CRYPTO_SELL/FRACTIONAL_ORDER": {
                payee = transaction.assetSymbol;
                memo = `Sold ${transaction.assetQuantity} ${transaction.assetSymbol}`;
                trnType = "CREDIT";
                break;
            }
            case "DEPOSIT/AFT": {
                payee = transaction.aftOriginatorName;
                memo = `Direct deposit from ${transaction.aftOriginatorName}`;
                trnType = "DEP";
                break;
            }
            case "WITHDRAWAL/AFT": {
                payee = transaction.aftOriginatorName;
                memo = `Direct deposit to ${transaction.aftOriginatorName}`;
                trnType = "DEBIT";
                break;
            }
            case "DEPOSIT/EFT": {
                let info = await fundsTransfer(transaction.externalCanonicalId);
                let bankInfo = info?.source?.bankAccount;
                if (!bankInfo) {
                    console.error(
                        "[ofx-export] bankInfo was undefined in EFT deposit:",
                        transaction,
                    );
                    continue;
                }
                payee = `${bankInfo.institutionName} ${bankInfo.nickname || bankInfo.accountName} ${bankInfo.accountNumber || ""}`;
                memo = `Direct deposit from ${payee}`;
                trnType = "DEP";
                break;
            }
            case "WITHDRAWAL/EFT": {
                let info = await fundsTransfer(transaction.externalCanonicalId);
                let bankInfo = info?.source?.bankAccount;
                if (!bankInfo) {
                    console.error(
                        "[ofx-export] bankInfo was undefined in EFT withdraw:",
                        transaction,
                    );
                    continue;
                }
                payee = `${bankInfo.institutionName} ${bankInfo.nickname || bankInfo.accountName} ${bankInfo.accountNumber || ""}`;
                memo = `Direct deposit to ${payee}`;
                trnType = "DEBIT";
                break;
            }
            case "INTERNAL_TRANSFER/SOURCE": {
                payee = accountNicknames[transaction.opposingAccountId];
                memo = `Internal transfer to ${payee}`;
                trnType = "XFER";
                break;
            }
            case "INTERNAL_TRANSFER/DESTINATION": {
                payee = accountNicknames[transaction.opposingAccountId];
                memo = `Internal transfer from ${payee}`;
                trnType = "XFER";
                break;
            }
            case "SPEND/PREPAID": {
                payee = transaction.spendMerchant;
                memo = `Prepaid to ${payee}`;
                trnType = "POS";
                break;
            }
            case "WITHDRAWAL/BILL_PAY": {
                payee = transaction.billPayPayeeNickname;
                memo = `Bill payment to ${transaction.billPayCompanyName}`;
                trnType = "PAYMENT";
                break;
            }
            default: {
                console.error(
                    `[ofx-export] ${dateStr} transaction [${type}] has unexpected type, skipping it. Please report on greasyfork.org for assistance.`,
                );
                console.log(transaction);
                continue;
            }
        }

        // Format amount
        let amount = transaction.amount;
        if (transaction.amountSign === "negative") {
            amount = `-${amount}`;
        }

        // Generate unique transaction ID
        let fitid = transaction.canonicalId || `${date.getTime()}-${Math.random().toString(36).substr(2, 9)}`;

        // Build transaction entry
        if (ofxAccountType === "INVESTMENT" && (type.includes("DIY_") || type.includes("CRYPTO_"))) {
            // For investment transactions
            ofx += `<INVBANKTRAN>
<STMTTRN>
<TRNTYPE>${trnType}
<DTPOSTED>${dateStr}
<TRNAMT>${amount}
<FITID>${escapeXml(fitid)}
`;
            if (payee) ofx += `<NAME>${escapeXml(payee)}\n`;
            if (memo) ofx += `<MEMO>${escapeXml(memo)}\n`;
            ofx += `</STMTTRN>
</INVBANKTRAN>
`;
        } else {
            // Regular transaction format
            ofx += `<STMTTRN>
<TRNTYPE>${trnType}
<DTPOSTED>${dateStr}
<TRNAMT>${amount}
<FITID>${escapeXml(fitid)}
`;
            if (payee) ofx += `<NAME>${escapeXml(payee)}\n`;
            if (memo) ofx += `<MEMO>${escapeXml(memo)}\n`;
            ofx += `</STMTTRN>
`;
        }
    }

    // Close OFX structure based on account type
    if (isCreditCard) {
        ofx += `</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>0
<DTASOF>${nowStr}
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;
    } else if (ofxAccountType === "INVESTMENT") {
        ofx += `</INVTRANLIST>
<INVBAL>
<AVAILCASH>0
<MARGINBALANCE>0
<SHORTBALANCE>0
</INVBAL>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`;
    } else {
        ofx += `</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>0
<DTASOF>${nowStr}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;
    }

    return new Blob([ofx], { type: "application/x-ofx" });
}


/**
* @param {{[string]: Blob}} accountBlobs
* @param {[AccountInfo]} accountsInfo
* @param {Date?} fromDate
*/
function saveBlobsToFiles(accountBlobs, accountsInfo, fromDate) {
    for (let acc in accountBlobs) {
        let blobUrl = URL.createObjectURL(accountBlobs[acc]);

        let link = document.createElement("a");
        link.href = blobUrl;
        link.download = `${acc}.ofx`;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
    }
}
