/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useRef, useState } from "react";
import { HourglassOutline } from "@makeplane/propel/icons";
import { getButtonStyling } from "@plane/propel/button";
import { cn, isValidWorkingDaysCount } from "@plane/utils";

type Props = {
  /** working days to display, either entered by the user or derived from the current dates */
  value: number | undefined;
  /** called with a positive integer, or null when the field is cleared */
  onChange: (value: number | null) => void;
  placeholder: string;
  buttonVariant: "border-with-text" | "transparent-with-text";
  disabled?: boolean;
  tabIndex?: number;
  className?: string;
  inputClassName?: string;
};

/** only whole, non negative numbers may be typed, the empty string clears the field */
const DIGITS_ONLY = /^\d*$/;

/**
 * Free text entry for the number of working days a work item should take.
 *
 * The value is committed on blur and on Enter rather than on every keystroke, so typing "12" does not
 * first schedule the work item for a single day.
 */
export const WorkingDaysInput = React.forwardRef(function WorkingDaysInput(
  props: Props,
  ref: React.ForwardedRef<HTMLInputElement>
) {
  const { value, onChange, placeholder, buttonVariant, disabled = false, tabIndex, className, inputClassName } = props;
  const [inputValue, setInputValue] = useState(value !== undefined ? `${value}` : "");
  const isFocusedRef = useRef(false);

  // follow the derived value, unless the user is in the middle of typing their own
  useEffect(() => {
    if (isFocusedRef.current) return;
    setInputValue(value !== undefined ? `${value}` : "");
  }, [value]);

  const commit = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue === "") {
      onChange(null);
      return;
    }
    const parsedValue = Number(trimmedValue);
    if (!isValidWorkingDaysCount(parsedValue)) {
      // reject anything that is not a positive integer and fall back to the current value
      setInputValue(value !== undefined ? `${value}` : "");
      return;
    }
    onChange(parsedValue);
  };

  return (
    <div
      className={cn(
        getButtonStyling("ghost", "sm"),
        "flex h-full w-full items-center justify-start gap-1.5",
        {
          "border-[0.5px] border-strong": buttonVariant === "border-with-text",
          "cursor-not-allowed opacity-60": disabled,
        },
        className
      )}
    >
      <HourglassOutline className="h-3 w-3 flex-shrink-0" />
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={placeholder}
        className={cn(
          "placeholder-placeholder w-full min-w-0 border-none bg-transparent p-0 text-body-xs-regular focus:ring-0 focus:outline-none disabled:cursor-not-allowed",
          inputClassName
        )}
        disabled={disabled}
        placeholder={placeholder}
        tabIndex={tabIndex}
        value={inputValue}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onChange={(e) => {
          if (!DIGITS_ONLY.test(e.target.value)) return;
          setInputValue(e.target.value);
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setInputValue(value !== undefined ? `${value}` : "");
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
});
