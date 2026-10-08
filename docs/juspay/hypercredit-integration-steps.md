# Juspay — Hypercredit Integration Steps

**Source:** "Copy of Hypercredit Integration Steps.pdf", supplied by Juspay.
**Filed:** 2026-09-28.
**Status:** vendor documentation, verbatim. Do not edit to match our build — if
something here is wrong, raise it with Juspay.

> **Juspay's own caveat, stated twice in the document:** *"The fields in the
> request might change depending on the finalisation of the journey with the
> lender."* Treat every payload shape below as provisional.

Read [integration-notes.md](./integration-notes.md) for what this means for our
build, what it answers, and what is still outstanding.

---

## Overview

The merchant integrates the APIs below to create a session order on Juspay and
to initiate an **auth-and-capture** flow.

---

## 1. Session Order API

Creates a new order within Juspay and returns URL links and other order
information.

| Endpoint | |
|---|---|
| UAT | `POST https://sandbox.juspay.in/session` |
| Prod | `POST https://api.juspay.in/session` |

### Headers

| Field | Mandatory | Type | Description |
|---|---|---|---|
| `Authorization` | Yes | String | The unique identifier provided to the merchant by Juspay. Merchant generates the API key on the Juspay dashboard. |
| `Content-Type` | Yes | String | `application/json` |
| `X-Request-Id` | Yes | String | Unique Identifier |

### Request payload

| Field | Mandatory | Type | Description |
|---|---|---|---|
| `order_id` | Yes | String | The unique identifier for the merchant by Juspay. |
| `amount` | Yes | Double | The amount of the order. |
| `description` | No | String | A brief description of the payment. |
| `currency` | Yes | String | Default as "INR" |
| `customer_id` | Yes | String | The unique identifier for the customer. |
| `customer_email` | No | String | The email address of the customer. |
| `customer_phone` | Yes | String | The phone number of the customer. |
| `customer_dob` | No | DD-MM-YYYY | The date of birth of the customer. |
| `customer_first_name` | No | String | The first name of the customer. |
| `customer_middle_name` | No | String | The middle name of the customer. |
| `customer_last_name` | No | String | The last name of the customer. |
| `customer_gender` | No | String | Male \| Female \| Others |
| `customer_marital_status` | No | String | Single \| Married |
| `customer_address_line1` | No | String | The first line of the customer's address. |
| `customer_address_line2` | No | String | The second line of the customer's address. |
| `customer_pincode` | No | String | The pincode of the customer's address. |
| `customer_employment_type` | No | String | SALARIED \| SELF_EMPLOYED |
| `metadata.source` | No | String | Channel source of the order (e.g., Online) |
| `payment_page_client_id` | Yes | String | The client ID for the payment page. |
| **`metadata.order_basket`** | **Yes** | [Object] | Array of items in the order basket |
| &nbsp;&nbsp;`brand` | Yes | String | Brand of product |
| &nbsp;&nbsp;`category` | Yes | String | Category of product |
| &nbsp;&nbsp;`sub_category` | Yes | String | Sub-category/SKU of product |
| &nbsp;&nbsp;`product_name` | Yes | String | Name of vehicle |
| &nbsp;&nbsp;`product_price` | Yes | Double | Price of single vehicle |
| &nbsp;&nbsp;`rto_charges` | No | Double | RTO charges for the vehicle |
| &nbsp;&nbsp;`total_amount` | Yes | Double | Total amount (On Road Price) |
| &nbsp;&nbsp;`unit` | Yes | Double | No. of units of product |
| **`metadata.dealer_details`** | **Yes** | Object | Dealer Details |
| &nbsp;&nbsp;`dealer_code` | Yes | String | Code of selected dealer |
| &nbsp;&nbsp;`dealer_name` | Yes | String | Name of selected dealer |
| **`metadata.delivery_address`** | **Yes** | Object | The delivery address details |
| &nbsp;&nbsp;`address_line_1` | Yes | String | Line 1 of delivery address |
| &nbsp;&nbsp;`address_line_2` | Yes | String | Line 2 of delivery address |
| &nbsp;&nbsp;`city` | No | String | City of delivery address |
| &nbsp;&nbsp;`state` | No | String | State of delivery address |
| &nbsp;&nbsp;`pincode` | Yes | String | Pincode of delivery address |
| &nbsp;&nbsp;`address_type` | Yes | String | Default as "DELIVERY" |
| `action` | Yes | String | Default as "paymentPage" |
| `metadata.webhook_url` | No | String | The merchant webhook URL for response. |
| **`payment_rule`** | No | Payment Rule Object | Information about part payments — e.g. rules to show payment. A sample payload is shared which can be used exactly for the use case where only loan is to be shown as first payment method, and all the other payments supported by merchants for downpayment except loan. |
| &nbsp;&nbsp;`plan_due_date` | No | String | A Unix Timestamp value to define the expiration of the order to complete the transactions. Utilize this to set a time to complete the downpayment transaction if any. |
| &nbsp;&nbsp;`plan_id` | No | String | A unique identifier for the payment plans. |
| `return_url` | Yes | String | The merchant URL to return to after payment. |

### Response payload

| Field | Mandatory | Type | Description |
|---|---|---|---|
| `status` | Yes | String | Status of order |
| `id` | Yes | String | Juspay ID |
| `order_id` | Yes | String | Merchant ID of order |
| `payment_links` | Yes | JSON | Contains link for payment redirection and expiry time |
| `sdk_payload` | Yes | JSON | Process SDK Call payload |
| `order_expiry` | Yes | Timestamp | Juspay order expiry time |

### Sample request

```json
{
    "order_id": "ORDER4567TGHk875",
    "amount": "30500",
    "description": "Complete your payment",
    "currency": "INR",
    "customer_id": "CUST57SDFG",
    "customer_email": "testeml.123@gmail.com",
    "customer_phone": "890956789",
    "customer_dob": "06-12-1997",
    "customer_first_name": "John",
    "customer_middle_name": "",
    "customer_last_name": "Doe",
    "customer_gender": "Male",
    "customer_marital_status": "Married",
    "customer_address_line1": "address line 1",
    "customer_address_line2": "address line 2",
    "customer_pincode": "560095",
    "customer_employment_type": "SALARIED",
    "metadata.source": "Online",
    "payment_page_client_id": "testcredit",
    "metadata.order_basket": [
        {
            "brand": "Ampere",
            "category": "Automobile",
            "sub_category": "Low Speed EV",
            "product_name": "Ampere Magnus",
            "product_price": 130500,
            "rto_charges": 13050,
            "total_amount": 143550,
            "unit": 1
        }
    ],
    "metadata.delivery_address": {
        "address_line_1": "Vimanagar Near",
        "address_line_2": "clover Park",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411014",
        "address_type": "DELIVERY"
    },
    "metadata.dealer_details": {
        "dealer_code": "DFGBFB5656",
        "dealer_name": ""
    },
    "action": "paymentPage",
    "payment_rules": {
        "payment_flows": {
            "part_payment": {
                "status": "OPTIONAL",
                "info": {
                    "plan_info": [
                        {
                            "plan_type": "EDITABLE",
                            "editable_plan_details": [
                                {
                                    "minimum_part_amount": "1",
                                    "plan_due_date": "1762807151",
                                    "maximum_no_of_parts": 2,
                                    "plan_title": "Pay as you like",
                                    "plan_description": "",
                                    "plan_id": "123454",
                                    "parts_info": [
                                        {
                                            "part_number": 1,
                                            "payment_filter": {
                                                "allowDefaultOptions": false,
                                                "options": [
                                                    {
                                                        "paymentMethodType": "CONSUMER_FINANCE",
                                                        "paymentMethodSubTypes": ["CF_LSP"],
                                                        "enable": true
                                                    },
                                                    {
                                                        "paymentMethodType": "CONSUMER_FINANCE",
                                                        "paymentMethodSubTypes": ["CF_EMI"],
                                                        "enable": false
                                                    }
                                                ],
                                                "emiOptions": {
                                                    "standardEmi": { "enable": false },
                                                    "lowCostEmi": { "enable": false },
                                                    "noCostEmi": { "enable": false }
                                                }
                                            }
                                        },
                                        {
                                            "part_number": 2,
                                            "payment_filter": {
                                                "allowDefaultOptions": true,
                                                "options": [
                                                    {
                                                        "paymentMethodType": "CONSUMER_FINANCE",
                                                        "paymentMethodSubTypes": ["CF_LSP"],
                                                        "enable": false
                                                    }
                                                ]
                                            }
                                        }
                                    ]
                                }
                            ],
                            "plan_type_description": "",
                            "fixed_plan_details": null,
                            "plan_type_title": ""
                        }
                    ]
                }
            }
        }
    },
    "metadata.webhook_url": "https://merchant.webhookurl.com/env/webhook_url_response",
    "return_url": "https://merchant.returnurl.com/#thankyoupage"
}
```

> Note: the sample as supplied has JSON syntax errors — a missing comma after
> `rto_charges`, a missing comma after the `metadata.dealer_details` block, and
> the request field is documented as `payment_rule` but written as
> `payment_rules` in the sample. Reproduced here with the commas corrected so
> the block parses; the `payment_rule`/`payment_rules` discrepancy is left as
> supplied and is on the question list.

### Sample response

```json
{
    "status": "NEW",
    "id": "ordeh_5b57ecf3da7841198dd3c0c50a5ac3cb",
    "order_id": "ORDER4567TGHk875",
    "payment_links": {
        "web": "https://sandbox.assets.juspay.in/payment-page/order/ordeh_5b57ecf3da7841198dd3c0c50a5ac3cb",
        "expiry": "2024-12-26T10:12:55Z"
    },
    "sdk_payload": {
        "requestId": "0fa4d42c05e94873b3aee5def9d49002",
        "service": "in.juspay.hyperpay",
        "payload": {
            "order_id": "ORDER4567TGHk875",
            "amount": "30500",
            "...": "echoes the request fields",
            "options.get_client_auth_token": "true",
            "metadata.sdk_payload": "true",
            "return_url": "https://merchant.returnurl.com/#thankyoupage"
        },
        "expiry": "2024-12-26T10:12:55Z"
    },
    "order_expiry": "2024-12-26T10:12:55Z"
}
```

---

## 2. Fetching order status

Status can be fetched two ways — consuming the **webhook**, or polling the
**order status API**.

- Webhook payload reference: <https://juspay.io/in/docs/hyper-checkout/web/base-sdk-integration/webhooks>
- Order status API reference: <https://juspay.io/in/docs/part-payments/docs/integration/order-status-api>

The following `txn_status` values are to be considered for the downstream loan
application processes:

| Status | Description | Action |
|---|---|---|
| `VBV_SUCCESSFUL` | VKYC verification is complete but pending audit | Juspay to collect downpayment |
| `AUTHORIZED` | Transaction has been pre-authorized and ready to be charged (VKYC has been verified and loan has been granted.) | Juspay to collect downpayment in case of no VKYC. **Merchant to call capture API with invoice details.** |
| `CHARGED` | Transaction has been charged (loan has been made active). This will be provided when TVSC provides loan booking confirmation along with loan ID. | Merchant to intimate customer about order success |

It is also recommended to poll the Order Status API to fetch the latest order
and transaction status.

### Notes

1. The loan ID of TVS Credit for loan transactions will be provided as
   `epg_txn_id` in order status and webhook, inside the corresponding
   transaction detail block.
2. **In case the downpayment is applicable, there will be two transactions** —
   one for loan payment and one for downpayment collection. The loan payment
   will have `pg` as LSP and the downpayment will be collected via one of the
   PGs enabled.
3. The transaction amount for each of the respective transactions shall sum up
   to the overall order amount.

---

## 3. Capture API

Invoked by the merchant for the auth-and-capture flow, where the merchant
provides a final confirmation to charge. Merchant would have internal triggers
(e.g. document uploads) and Juspay webhook-based triggers (`txn_status` =
`AUTHORIZED` for LSP as gateway, and `CHARGED` for DP). Where the full amount is
financed by loan, the `txn_amount` should be considered.

To capture the full payment, the transaction UUID for the transaction having the
**LSP gateway** shall be used, whose status is `AUTHORIZED`.

| Endpoint | |
|---|---|
| UAT | `POST https://sandbox.juspay.in/v2/txns/{txn_uuid}/capture` |
| Prod | `POST https://api.juspay.in/v2/txns/{txn_uuid}/capture` |

### Headers

| Field | Mandatory | Type | Description |
|---|---|---|---|
| `Authorization` | Yes | String | The unique identifier provided to the merchant by Juspay. |
| `Content-Type` | Yes | String | `application/json` |
| `x-routing-id` | Yes | String | Unique identifier for merchant for tracking and analytics (e.g., merchant order ID) |

### Request payload

| Field | Mandatory | Type | Description |
|---|---|---|---|
| `Merchant Metadata` | Yes | Object | Merchant metadata |
| `invoiceDownloadURL` | No | String | URL for invoice download |
| `invoice` | No | Object | Invoice details |
| &nbsp;&nbsp;`DocumentFormat` | Yes | String | PDF \| JPG \| OTHERS |
| &nbsp;&nbsp;`DocumentType` | Yes | String | INSURANCE \| OTHERS \| INVOICE |
| &nbsp;&nbsp;`Data` | Yes | Base-64 encoded value | Invoice data |

### Sample request

```json
{
    "metadata": "{\"invoiceDownloadURL\":\"www.google.com\",\"invoice\":{\"DocumentFormat\":\"JSON\",\"DocumentType\":\"INVOICE\",\"Data\":\"YmFzZS02NCBlbmNvZGVkIGludm9pY2UgZGF0YQ==\"}}"
}
```

Note the shape: `metadata` is a **JSON-encoded string**, not a nested object.
Note also that the sample passes `DocumentFormat: "JSON"`, which is not one of
the documented values (PDF | JPG | OTHERS).

### Sample response

```json
{
  "udf1": "", "udf2": "", "udf3": "", "udf4": "", "udf5": "",
  "udf6": "", "udf7": "", "udf8": "", "udf9": "", "udf10": "",
  "txn_uuid": "euld46jp7R1jE3tB8ss",
  "txn_id": "merchant_id-order_id-1",
  "status_id": 21,
  "status": "CHARGED",
  "return_url": "https://api.juspay.in",
  "refunded": false,
  "product_id": "",
  "payment_method_type": "CONSUMER_FINANCE",
  "payment_method": "TVS_LSP",
  "payment_links": {
      "web": "https://api.juspay.in/merchant/pay/ord_7f609710bf6f4379b5917ee5afd8386b",
      "mobile": "https://api.juspay.in/merchant/pay/ord_7f609710bf6f4379b5917ee5afd8386b?mobile=true",
      "iframe": "https://api.juspay.in/merchant/ipay/ord_7f609710bf6f4379b5917ee5afd8386b"
  },
  "payment_gateway_response": {
      "txn_id": "merchant_id-order_id-1",
      "rrn": "",
      "resp_message": "Capture successful",
      "resp_code": "SUCCESS",
      "epg_txn_id": "14326152",
      "created": "2019-03-01T08:34:40Z",
      "auth_id_code": "NA"
  },
  "order_id": "92348923409",
  "merchant_id": "merchant_id",
  "id": "ord_7f609710bf6f4379b5917ee5afd8386b",
  "gateway_id": 70,
  "date_created": "2019-03-01T08:33:49Z",
  "customer_phone": null,
  "customer_id": "FUR14920977945",
  "customer_email": null,
  "currency": "INR",
  "card": {},
  "bank_error_message": "PRE_AUTH|Transaction Successful | Approved",
  "bank_error_code": "SUCCESS",
  "auth_type": "THREE_DS",
  "amount_refunded": 0,
  "amount": 10,
  "refunds": []
}
```

---

## 4. Handling refunds

Refunds are invoked via API and **must be done at each transaction level**. If
an order involves multiple transactions (loan and downpayment), the refund API
must be invoked for each transaction.

Reference: <https://juspay.io/in/docs/part-payments/docs/integration/update-and-refund-api>

> **Note:** the merchant must pass order expiry in the session API to enable
> auto-refunds in case the order is not successful within the fulfilment period.
