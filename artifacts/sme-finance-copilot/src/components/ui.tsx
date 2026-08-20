import React, { forwardRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive', size?: 'default' | 'sm' | 'lg' | 'icon' }>(({ className, variant = 'default', size = 'default', ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        {
          'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm': variant === 'default',
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground': variant === 'outline',
          'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
          'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm': variant === 'destructive',
          'h-10 px-4 py-2': size === 'default',
          'h-8 rounded-md px-3 text-xs': size === 'sm',
          'h-12 rounded-xl px-8 text-base': size === 'lg',
          'h-9 w-9': size === 'icon',
        },
        className
      )}
      {...props}
    />
  );
});
Button.displayName = 'Button';

export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-2xl border border-card-border bg-card text-card-foreground shadow-sm", className)} {...props} />
));
Card.displayName = 'Card';

export const Badge = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' }>(({ className, variant = 'default', ...props }, ref) => (
  <div ref={ref} className={cn(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    {
      'border-transparent bg-primary text-primary-foreground': variant === 'default',
      'border-transparent bg-secondary text-secondary-foreground': variant === 'secondary',
      'text-foreground': variant === 'outline',
      'border-transparent bg-destructive text-destructive-foreground': variant === 'destructive',
      'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100': variant === 'success',
      'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100': variant === 'warning',
    },
    className
  )} {...props} />
));
Badge.displayName = 'Badge';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y",
      className
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Label = forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
    {...props}
  />
));
Label.displayName = 'Label';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none",
      className
    )}
    {...props}
  />
));
Select.displayName = 'Select';
