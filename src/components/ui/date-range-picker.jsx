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

function startOfDayLocal(value) {
  const date = toDate(value)
  if (!date) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function endOfDayLocal(value) {
  const date = toDate(value)
  if (!date) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
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
  const [tempRange, setTempRange] = React.useState(normalized)
  const [month, setMonth] = React.useState(normalized.start || normalized.end || new Date())
  const hasSelection = Boolean(normalized.start || normalized.end)

  const {
    numberOfMonths = 2,
    locale: calendarLocale,
    onDayClick: externalOnDayClick,
    ...restCalendarProps
  } = calendarProps ?? {}

  React.useEffect(() => {
    if (normalized.start) {
      setMonth(normalized.start)
    } else if (normalized.end) {
      setMonth(normalized.end)
    }
  }, [normalized.start?.getTime?.(), normalized.end?.getTime?.()])

  React.useEffect(() => {
    if (!open) {
      setTempRange(normalized)
    }
  }, [open, normalized.start?.getTime?.(), normalized.end?.getTime?.()])

  const handleOpenChange = React.useCallback(
    (nextOpen) => {
      setOpen(nextOpen)
      if (nextOpen) {
        setTempRange(normalized)
        const focusDate = normalized.start || normalized.end
        if (focusDate) {
          setMonth(focusDate)
        }
      }
    },
    [normalized.end?.getTime?.(), normalized.start?.getTime?.()]
  )

  const formatDate = React.useCallback(
    (date) => {
      if (!date) return ""
      try {
        return calendarLocale
          ? format(date, "dd MMM yyyy", { locale: calendarLocale })
          : format(date, "dd MMM yyyy")
      } catch (error) {
        return format(date, "dd MMM yyyy")
      }
    },
    [calendarLocale]
  )

  const formattedLabel = React.useMemo(() => {
    const { start, end } = normalized
    if (start && end) {
      return `${formatDate(start)} – ${formatDate(end)}`
    }
    if (start) {
      return `${formatDate(start)} – …`
    }
    if (end) {
      return `… – ${formatDate(end)}`
    }
    return ""
  }, [formatDate, normalized.end?.getTime?.(), normalized.start?.getTime?.()])

  const handleDayClick = React.useCallback(
    (day, modifiers, event) => {
      const clicked = startOfDayLocal(day)
      if (!clicked) return

      const currentStart = tempRange.start ? startOfDayLocal(tempRange.start) : null
      const currentEnd = tempRange.end ? endOfDayLocal(tempRange.end) : null

      // Start nieuw bereik als er nog niets is of als er al een compleet bereik stond
      if (!currentStart || (currentStart && currentEnd)) {
        setTempRange({ start: clicked, end: null })
        setMonth(clicked)
        externalOnDayClick?.(day, modifiers, event)
        return
      }

      // Tweede klik eerder dan start -> vervang start
      if (clicked < currentStart) {
        setTempRange({ start: clicked, end: null })
        setMonth(clicked)
        externalOnDayClick?.(day, modifiers, event)
        return
      }

      const newRange = { start: currentStart, end: endOfDayLocal(day) }
      setTempRange(newRange)
      onChange?.(newRange)
      setMonth(clicked)
      externalOnDayClick?.(day, modifiers, event)
    },
    [externalOnDayClick, onChange, tempRange.end, tempRange.start]
  )

  const handleReset = React.useCallback(() => {
    const emptyRange = { start: null, end: null }
    setTempRange(emptyRange)
    onChange?.(emptyRange)
  }, [onChange])

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <Label htmlFor={id} className="px-1 text-sm font-medium text-foreground">
          {label}
        </Label>
      ) : null}
      <Popover open={open} onOpenChange={handleOpenChange}>
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
            aria-label={label ? `${label} kiezen` : placeholder}
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
            selected={{
              from: tempRange.start ?? undefined,
              to: tempRange.end ?? undefined,
            }}
            onMonthChange={setMonth}
            onDayClick={handleDayClick}
            initialFocus
            locale={calendarLocale}
            {...restCalendarProps}
          />
          {showClearButton ? (
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {tempRange.start && tempRange.end
                  ? `${formatDate(tempRange.start)} – ${formatDate(tempRange.end)}`
                  : tempRange.start
                    ? `${formatDate(tempRange.start)} – …`
                    : "Kies een begin- en einddatum"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={!tempRange.start && !tempRange.end}
                >
                  Reset
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                >
                  Sluiten
                </Button>
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

