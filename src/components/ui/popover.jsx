"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const PopoverContext = React.createContext(null)

function usePopoverContext(component) {
  const context = React.useContext(PopoverContext)
  if (!context) {
    throw new Error(`${component} must be used within <Popover />`)
  }
  return context
}

function composeRefs(...refs) {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === "function") {
        ref(node)
      } else {
        ref.current = node
      }
    }
  }
}

const Popover = ({ open: openProp, defaultOpen = false, onOpenChange, children }) => {
  const triggerRef = React.useRef(null)
  const contentRef = React.useRef(null)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const setOpen = React.useCallback(
    (value) => {
      const next = typeof value === "function" ? value(open) : value
      if (!isControlled) {
        setUncontrolledOpen(next)
      }
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange, open]
  )

  const close = React.useCallback(() => setOpen(false), [setOpen])

  React.useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        close()
      }
    }

    const handlePointerDown = (event) => {
      const target = event.target
      if (!triggerRef.current || !contentRef.current) return
      if (
        target instanceof Node &&
        !triggerRef.current.contains(target) &&
        !contentRef.current.contains(target)
      ) {
        close()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [open, close])

  const value = React.useMemo(
    () => ({
      open,
      setOpen,
      close,
      triggerRef,
      contentRef,
    }),
    [open, setOpen, close]
  )

  return <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>
}
Popover.displayName = "Popover"

const PopoverTrigger = React.forwardRef(({ asChild = false, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopoverContext("PopoverTrigger")
  const Component = asChild ? Slot : "button"

  const composedRef = React.useMemo(() => composeRefs(ref, triggerRef), [ref, triggerRef])

  return (
    <Component
      type={Component === "button" ? "button" : undefined}
      aria-expanded={open}
      data-state={open ? "open" : "closed"}
      ref={composedRef}
      onClick={(event) => {
        onClick?.(event)
        setOpen((current) => !current)
      }}
      {...props}
    />
  )
})
PopoverTrigger.displayName = "PopoverTrigger"

const PopoverContent = React.forwardRef(
  (
    { className, align = "center", sideOffset = 4, style, alignOffset = 0, ...props },
    ref
  ) => {
    const { open, triggerRef, contentRef } = usePopoverContext("PopoverContent")
    const [mounted, setMounted] = React.useState(false)
    const [position, setPosition] = React.useState({ top: 0, left: 0 })

    const updatePosition = React.useCallback(() => {
      const trigger = triggerRef.current
      const content = contentRef.current
      if (!trigger || !content) return

      const rect = trigger.getBoundingClientRect()
      const scrollX = window.pageXOffset
      const scrollY = window.pageYOffset
      let left = rect.left + scrollX

      if (align === "center") {
        left = rect.left + scrollX + rect.width / 2 - content.offsetWidth / 2 + alignOffset
      } else if (align === "end") {
        left = rect.right + scrollX - content.offsetWidth + alignOffset
      } else {
        left = rect.left + scrollX + alignOffset
      }

      const top = rect.bottom + scrollY + sideOffset
      setPosition({ top, left })
    }, [align, alignOffset, sideOffset, triggerRef, contentRef])

    React.useLayoutEffect(() => {
      if (!open) return undefined
      setMounted(true)
      updatePosition()
      const handle = () => updatePosition()
      window.addEventListener("resize", handle)
      window.addEventListener("scroll", handle, true)
      return () => {
        window.removeEventListener("resize", handle)
        window.removeEventListener("scroll", handle, true)
      }
    }, [open, updatePosition])

    React.useEffect(() => {
      if (!open) return
      const timer = requestAnimationFrame(updatePosition)
      return () => cancelAnimationFrame(timer)
    }, [open, updatePosition])

    if (!mounted || !open) {
      return null
    }

    const composedRef = composeRefs(ref, contentRef)

    return createPortal(
      <div
        role="dialog"
        ref={composedRef}
        style={{ position: "absolute", top: position.top, left: position.left, ...style }}
        data-state={open ? "open" : "closed"}
        className={cn(
          "z-50 min-w-[8rem] rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          className
        )}
        {...props}
      />,
      document.body
    )
  }
)
PopoverContent.displayName = "PopoverContent"

const PopoverAnchor = React.forwardRef(({ className, ...props }, ref) => {
  const { triggerRef } = usePopoverContext("PopoverAnchor")
  const composedRef = React.useMemo(() => composeRefs(ref, triggerRef), [ref, triggerRef])
  return <div ref={composedRef} className={className} {...props} />
})
PopoverAnchor.displayName = "PopoverAnchor"

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }