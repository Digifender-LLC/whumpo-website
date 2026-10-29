import * as React from "react"

import { cn } from "@/lib/utils"

// Placeholder block for loading states where the layout is known. Size it with className.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("skeleton rounded-sm", className)} {...props} />
}

export { Skeleton }
