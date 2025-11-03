"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

function normalizeRange(range) {
  if (!range) return { start: null, end: null }
  const start = range.start instanceof Date ? range.start : range.start ? new Date(range.start) : null
  const end = range.end instanceof Date ? range.end : range.end ? new Date(range.end) : null
  return { start, end }
}

export function DateRangePicker({
  id = "export-range",
  label,
  value,
  onChange,
  placeholder = "Selecteer datums",
  className = "",
}) {
  const [open, setOpen] = React.useState(false)
  const normalized = normalizeRange(value)
  const [month, setMonth] = React.useState(normalized.start || normalized.end || new Date())

  React.useEffect(() => {
    const { start, end } = normalizeRange(value)
    if (start) {
      setMonth(start)
    } else if (end) {
      setMonth(end)
    }
  }, [value?.start, value?.end])

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
  }, [normalized.start, normalized.end])

  const handleSelect = React.useCallback(
    (range) => {
      if (!onChange) return
      if (!range) {
        onChange({ start: null, end: null })
        return
      }

      const start = range.from ? new Date(range.from) : null
      const end = range.to ? new Date(range.to) : null

      onChange({ start, end: end || start })
    },
    [onChange]
  )

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
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
            className={`justify-start text-left font-normal ${
              formattedLabel ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <CalendarIcon className="mr-2 size-4" />
            {formattedLabel || placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={1}
            month={month}
            selected={{ from: normalized.start ?? undefined, to: normalized.end ?? undefined }}
            onMonthChange={setMonth}
            onSelect={(range) => {
              handleSelect(range)
              if (range?.from && range?.to) {
                setOpen(false)
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
