import { DialogContent, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Dialog content that opens as a bottom sheet on phones and centered from `sm` up. */
export function ResponsiveDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "top-auto bottom-0 max-h-[90dvh] max-w-full translate-y-0 overflow-y-auto rounded-b-none sm:top-1/2 sm:bottom-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-b-xl",
        className,
      )}
      {...props}
    />
  );
}

/** Footer that stays pinned to the bottom of the sheet while its content scrolls. */
export function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      className={cn(
        "sticky -bottom-4 bg-popover pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:bg-muted/50 sm:pb-4",
        className,
      )}
      {...props}
    />
  );
}
