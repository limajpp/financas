"use client";

import { Check } from "lucide-react";

import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PaymentChoice } from "@/domain/register";
import {
  type EntryType,
  METHODS_BY_TYPE,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/domain/transactions";

/**
 * Method first, then where the money comes from: an account, or a card on credit. Choosing the
 * account or card closes the sheet.
 */
export function PaymentSheet({
  open,
  onOpenChange,
  type,
  value,
  onChange,
  accounts,
  cards,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: EntryType;
  value: PaymentChoice;
  onChange: (value: PaymentChoice) => void;
  accounts: { id: string; name: string }[];
  cards: { id: string; name: string }[];
}) {
  const credit = value.method === "CREDIT";
  const options = credit ? cards : accounts;
  const selectedId = credit ? value.cardId : value.accountId;

  function chooseMethod(method: PaymentMethod) {
    onChange({ ...value, method });
  }

  function choosePlace(id: string) {
    onChange(credit ? { ...value, cardId: id } : { ...value, accountId: id });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <DialogHeader>
          <DialogTitle>Forma de pagamento</DialogTitle>
          <DialogDescription className="sr-only">
            Escolha a forma de pagamento e a conta ou o cartão.
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Forma de pagamento" className="grid grid-cols-3 gap-2">
          {METHODS_BY_TYPE[type].map((method) => {
            const noCard = method === "CREDIT" && cards.length === 0;
            return (
              <Button
                key={method}
                type="button"
                variant={value.method === method ? "default" : "outline"}
                aria-pressed={value.method === method}
                disabled={noCard}
                className="h-auto min-h-10 flex-col gap-0 py-1"
                onClick={() => chooseMethod(method)}
              >
                {PAYMENT_METHOD_LABELS[method]}
                {noCard && <span className="text-[11px] font-normal">Nenhum cartão</span>}
              </Button>
            );
          })}
        </div>

        <div className="grid gap-1">
          <p className="text-sm font-medium" id="payment-place">
            {credit ? "Cartão" : "Conta"}
          </p>
          <ul aria-labelledby="payment-place" className="grid gap-0.5">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  aria-pressed={option.id === selectedId}
                  onClick={() => choosePlace(option.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left hover:bg-muted aria-pressed:font-medium"
                >
                  <span className="truncate">{option.name}</span>
                  {option.id === selectedId && <Check aria-hidden className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <ResponsiveDialogFooter>
          <Button
            type="button"
            className="h-10 w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Pronto
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </Dialog>
  );
}
