// Kapture Finance Collections Voicebot — Mock Tool Webhook Server
// Implements the 7 tools from vapi_tool_schemas.json with canned/in-memory data
// for the demo scenario: Rahul Sharma, personal loan, EMI ₹8,499, 12 DPD.
//
// Zero dependencies — uses only Node's built-in http module, so there is
// NOTHING to npm install. Just run:   node server.js
//
// Then point each Vapi function's server.url at:
//   https://<your-deployed-url>/tools/<function_name>
// e.g. https://your-repl-name.username.repl.co/tools/verify_customer

const http = require("http");

// ---- Fake "database" — one customer, matches the assignment's example ----
const CUSTOMER = {
  customer_id: "cust_rahul_001",
  dob: "1990-04-15",             // the DOB Vapi must hear to authenticate
  last4: "4321",                 // last 4 digits of loan/PAN
  pincode: "500034",             // registered pincode
  loan_id: "loan_78234",
  product_type: "Personal Loan",
  emi_amount: 8499,
  dpd: 12,
  last_payment_date: "2026-06-28",
  outstanding_balance: 8499,
  payment_status: "overdue", // flip to "paid" via /admin/set-status to test the already-paid path
};

let ptpLog = {};         // keyed by loan_id+customer_id to demonstrate idempotency
let dncList = new Set(); // phone numbers that opted out

function log(name, body) {
  console.log(`\n[${new Date().toISOString()}] ${name} called with:`, JSON.stringify(body));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Flexible DOB matcher — accepts "1990-04-15", "April 15, 1990", "15/04/1990",
// "04-15-1990", etc. instead of requiring exact ISO format, since the AI won't
// always normalize speech into YYYY-MM-DD reliably.
function dobMatches(spoken, expectedIso) {
  if (!spoken) return false;
  const s = spoken.toLowerCase();
  const [expYear, expMonth, expDay] = expectedIso.split("-");
  const digitsOnly = s.replace(/[^0-9]/g, "");
  // Direct digit match in any common order: YYYYMMDD, MMDDYYYY, DDMMYYYY
  if (
    digitsOnly.includes(expYear + expMonth + expDay) ||
    digitsOnly.includes(expMonth + expDay + expYear) ||
    digitsOnly.includes(expDay + expMonth + expYear)
  ) {
    return true;
  }
  // Month-name based match: e.g. "april 15, 1990" / "15 april 1990"
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const monthName = monthNames[parseInt(expMonth, 10) - 1];
  const dayNum = String(parseInt(expDay, 10)); // "15" -> "15", "05" -> "5"
  const hasYear = s.includes(expYear);
  const hasMonth = s.includes(monthName) || s.includes(expMonth);
  const hasDay = new RegExp(`\\b0?${dayNum}\\b`).test(s);
  return hasYear && hasMonth && hasDay;
}

// Flexible pincode/last4 matcher — ignores spaces, dashes, and stray words
// (STT sometimes splits digits like "500. 034" or adds filler words).
function digitsMatch(spoken, expected) {
  if (!spoken) return false;
  const digitsOnly = spoken.replace(/[^0-9]/g, "");
  return digitsOnly === expected || digitsOnly.includes(expected);
}

const routes = {
  "/tools/verify_customer": async (body, res) => {
    log("verify_customer", body);
    const { spoken_dob, spoken_last4, spoken_pincode } = body;
    let matches = 0;
    if (dobMatches(spoken_dob, CUSTOMER.dob)) matches++;
    if (spoken_last4 && digitsMatch(spoken_last4, CUSTOMER.last4)) matches++;
    if (spoken_pincode && digitsMatch(spoken_pincode, CUSTOMER.pincode)) matches++;
    const match = matches >= 2;
    sendJson(res, 200, {
      match,
      match_factors: matches,
      customer_id: match ? CUSTOMER.customer_id : null,
    });
  },

  "/tools/get_account_details": async (body, res) => {
    log("get_account_details", body);
    if (body.customer_id !== CUSTOMER.customer_id) {
      return sendJson(res, 404, { error: "unknown customer_id" });
    }
    sendJson(res, 200, {
      loan_id: CUSTOMER.loan_id,
      product_type: CUSTOMER.product_type,
      emi_amount: CUSTOMER.emi_amount,
      dpd: CUSTOMER.dpd,
      last_payment_date: CUSTOMER.last_payment_date,
      outstanding_balance: CUSTOMER.outstanding_balance,
      payment_status: CUSTOMER.payment_status,
    });
  },

  "/tools/log_promise_to_pay": async (body, res) => {
    log("log_promise_to_pay", body);
    const key = `${body.loan_id}_${body.customer_id}`;
    if (ptpLog[key]) {
      return sendJson(res, 200, { ptp_id: ptpLog[key], status: "duplicate" });
    }
    const ptp_id = `ptp_${Date.now()}`;
    ptpLog[key] = ptp_id;
    sendJson(res, 200, { ptp_id, status: "logged" });
  },

  "/tools/send_payment_link": async (body, res) => {
    log("send_payment_link", body);
    sendJson(res, 200, { link_id: `link_${Date.now()}`, delivery_status: "sent" });
  },

  "/tools/escalate_to_agent": async (body, res) => {
    log("escalate_to_agent", body);
    sendJson(res, 200, {
      ticket_id: `tkt_${Date.now()}`,
      queue: body.reason === "hardship" ? "hardship_review" : "general_collections_review",
    });
  },

  "/tools/mark_disposition": async (body, res) => {
    log("mark_disposition", body);
    sendJson(res, 200, { ack: true });
  },

  "/tools/check_call_window": async (body, res) => {
    log("check_call_window", body);
    // Demo simplification: always allowed unless the number opted out via /admin/set-status.
    // (A real implementation would check the caller's local time against permitted hours —
    // left out here so testing at any hour of day doesn't accidentally block your demo call.)
    if (dncList.has(body.phone_number)) {
      return sendJson(res, 200, { allowed: false, reason: "number is on do-not-call list" });
    }
    sendJson(res, 200, { allowed: true, reason: "within permitted hours" });
  },

  // Helper (not a Vapi tool) so you can flip test conditions without redeploying:
  // POST /admin/set-status  { "payment_status": "paid" }  or  { "dnc": "+919999999999" }
  "/admin/set-status": async (body, res) => {
    if (body.payment_status) CUSTOMER.payment_status = body.payment_status;
    if (body.dnc) dncList.add(body.dnc);
    sendJson(res, 200, { ok: true, customer: CUSTOMER, dncList: [...dncList] });
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Kapture mock tool server is running. POST to /tools/<function_name>.");
  }
  const handler = routes[req.url];
  if (req.method === "POST" && handler) {
    const body = await readBody(req);
    return handler(body, res);
  }
  sendJson(res, 404, { error: "not found" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mock webhook server listening on port ${PORT}`));
