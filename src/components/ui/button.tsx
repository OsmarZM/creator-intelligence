import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";
export function Button({
  className,
  asChild = false,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "default" | "outline" | "ghost";
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(
        "button",
        variant === "outline" && "button-outline",
        variant === "ghost" && "button-ghost",
        className,
      )}
      {...props}
    />
  );
}
