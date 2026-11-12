import { TRANSACTION_ERROR_MESSAGES } from "@/domain/transactions";
import type { ActionFailure } from "@/lib/action-result";

export type TransactionErrorCode = keyof typeof TRANSACTION_ERROR_MESSAGES;

/** The form field each domain error belongs to. */
const FIELD_OF_ERROR: Partial<Record<TransactionErrorCode, string>> = {
  FUTURE_DATE: "date",
  DATE_TOO_OLD: "date",
  METHOD_NOT_ALLOWED: "method",
  ACCOUNT_NOT_FOUND: "accountId",
  ACCOUNT_ARCHIVED: "accountId",
  CARD_NOT_FOUND: "cardId",
  CARD_ARCHIVED: "cardId",
  CATEGORY_NOT_FOUND: "categoryId",
  CATEGORY_ARCHIVED: "categoryId",
  CATEGORY_TYPE_MISMATCH: "categoryId",
  INVALID_INVOICE: "invoiceDueDate",
  SAME_ACCOUNT: "toAccountId",
  TO_ACCOUNT_NOT_FOUND: "toAccountId",
  TO_ACCOUNT_ARCHIVED: "toAccountId",
  TOO_SMALL_FOR_INSTALLMENTS: "amountCents",
  INSTALLMENT_AMOUNT_SCOPE: "amountCents",
  INSTALLMENTS_ON_EDIT: "installments",
  SUBSCRIPTION_ON_EDIT: "subscription",
  SUBSCRIPTION_LOCKED: "type",
  NOT_CATEGORIZABLE: "categoryId",
  MIXED_TYPES: "categoryId",
};

/** A domain error as the pt-BR message the user sees, on its field. Shared by the actions and the sync. */
export function transactionFailure(code: TransactionErrorCode): ActionFailure {
  const error = TRANSACTION_ERROR_MESSAGES[code];
  const field = FIELD_OF_ERROR[code];
  return { ok: false, error, fieldErrors: field ? { [field]: error } : undefined };
}
