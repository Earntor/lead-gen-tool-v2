"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function toDate(value) {
  if (!value) return null
  const instance = value instanceof Date ? new Date(value) : new Date(value)
  return Number.isNaN(instance.getTime()) ? null : instance
}

function normalizeRange(range) {
  if (!range) return { start: null, end: null }

  if (Array.isArray(range)) {
    const [from, to] = range
    const start = toDate(from)
    const end = toDate(to)
    if (start && end && start > end) {
      return { start: end, end: start }
    }
    return { start, end }
  }

  const startCandidate = range.start ?? range.startDate ?? range.from ?? null
  const endCandidate = range.end ?? range.endDate ?? range.to ?? null
  const start = toDate(startCandidate)
  const end = toDate(endCandidate)

  if (start && end && start > end) {
    return { start: end, end: start }
  }

  return { start, end }
}

export function DateRangePicker({
  id = "export-range",
  label,
  value,
  onChange,
  placeholder = "Selecteer datums",
  className = "",
  triggerClassName = "",
  contentClassName = "",
  align = "start",
  calendarProps = {},
  showClearButton = true,
}) {
  const [open, setOpen] = React.useState(false)
  const normalized = React.useMemo(() => normalizeRange(value), [value])
  const [month, setMonth] = React.useState(normalized.start || normalized.end || new Date())
  const hasSelection = Boolean(normalized.start || normalized.end)

  const { numberOfMonths = 2, ...restCalendarProps } = calendarProps ?? {}

  React.useEffect(() => {
    if (normalized.start) {
      setMonth(normalized.start)
    } else if (normalized.end) {
      setMonth(normalized.end)
    }
  }, [normalized.start?.getTime?.(), normalized.end?.getTime?.()])

  const formattedLabel = React.useMemo(() => {
    const { start, end } = normalized
    if (start && end) {
      return `${format(start, "dd MMM yyyy")} – ${format(end, "dd MMM yyyy")}`
    }
    if (start) {
      return `${format(start, "dd MMM yyyy")} – …`
    }
    if (end) {
      return `… – ${format(end, "dd MMM yyyy")}`
    }
    return ""
  }, [normalized.start?.getTime?.(), normalized.end?.getTime?.()])

  const handleSelect = React.useCallback(
    (range) => {
      if (!onChange) return
      if (!range) {
        onChange({ start: null, end: null })
        return
      }

      const start = range.from ? toDate(range.from) : null
      const end = range.to ? toDate(range.to) : null

      onChange({ start, end })
    },
    [onChange]
  )

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <Label htmlFor={id} className="px-1 text-sm font-medium text-foreground">
          {label}
        </Label>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn(
              "justify-start text-left font-normal",
              formattedLabel ? "text-foreground" : "text-muted-foreground",
              hasSelection ? "border-primary/60" : "border-input",
              triggerClassName
            )}
          >
            <CalendarIcon className="mr-2 size-4" />
            {formattedLabel || placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "w-auto min-w-[18rem] p-0 sm:min-w-[34rem]",
            contentClassName
          )}
          align={align}
        >
          <Calendar
            mode="range"
            numberOfMonths={numberOfMonths}
            month={month}
            selected={{ from: normalized.start ?? undefined, to: normalized.end ?? undefined }}
            onMonthChange={setMonth}
            onSelect={(range) => {
              handleSelect(range)
              if (range?.to) {
                setMonth(range.to)
              } else if (range?.from) {
                setMonth(range.from)
              }
              if (range?.from && range?.to) {
                setOpen(false)
              }
            }}
            initialFocus
            {...restCalendarProps}
          />
          {showClearButton ? (
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {normalized.start && normalized.end
                  ? `${format(normalized.start, "dd MMM yyyy")} – ${format(normalized.end, "dd MMM yyyy")}`
                  : normalized.start
                    ? `${format(normalized.start, "dd MMM yyyy")} – …`
                    : "Geen datum geselecteerd"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  handleSelect(null)
                  setOpen(false)
                }}
                disabled={!hasSelection}
              >
                Reset
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

