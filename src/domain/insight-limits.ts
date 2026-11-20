/**
 * Every limit of the insight rules (src/domain/insights.ts), in one place to tune them. Spec:
 * docs/specs/tasks/24-insights.md.
 */
import { RECENT_CHANGE_DAYS } from "./subscriptions";

/** A category fires when its excess over the 3-month average is more than this share of it. */
export const CATEGORY_ABOVE_AVERAGE_RATIO = 0.25;
/** The least a category's excess, or a group of small purchases, must reach (R$ 50,00). */
export const MIN_IMPACT_CENTS = 5_000;
/** A "small" purchase is up to this amount, inclusive (R$ 30,00). */
export const SMALL_PURCHASE_MAX_CENTS = 3_000;
/** How many small purchases at one place (or in one category) make an insight. */
export const SMALL_PURCHASES_MIN_COUNT = 5;
/**
 * How long a subscription's raise stays an insight. Starts as the subscriptions screen's highlight
 * (task 19), so both agree; changing it here changes only the insight.
 */
export const SUBSCRIPTION_CHANGE_DAYS = RECENT_CHANGE_DAYS;
/** From this multiple of the average on, a category says "N vezes a média" instead of a percentage. */
export const TIMES_AVERAGE_FROM = 3;
/** The top counterparty fires when it takes more than this share of the month's expenses. */
export const TOP_COUNTERPARTY_MIN_SHARE = 0.2;
/** How many insights the dashboard shows. */
export const MAX_INSIGHTS = 3;
