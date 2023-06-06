type FocusContext = HTMLElement | (HTMLElement | null)[] | null

/**
 * how to use:
 *
 * ```typescript
 * import type { FocusableComponent } from "@micro-lc/compose-toolkit"
 *
 * class MyCustomComponent extends HTMLElement implements FocusableComponent {
 *   __focus_handler() => FocusCtx | Promise<FocusCtx> {
 *     // impl
 *   }
 *   __unfocus_handler() => void {
 *     // impl
 *   }
 * }
 * ```
 */
interface FocusableComponent {
  __focus_handler?: () => FocusContext | Promise<FocusContext>
  __unfocus_handler?: () => void
}

export type { FocusContext, FocusableComponent }
