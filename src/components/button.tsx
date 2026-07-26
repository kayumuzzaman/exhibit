import { forwardRef, type ButtonHTMLAttributes, type PropsWithChildren } from 'react';

export type ButtonTone = 'default' | 'primary' | 'danger' | 'quiet';

export const Button = forwardRef<
  HTMLButtonElement,
  PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & Readonly<{ tone?: ButtonTone }>
  >
>(function Button({ children, className = '', tone = 'default', type, ...props }, ref) {
  return (
    <button
      className={`button button--${tone} ${className}`.trim()}
      ref={ref}
      type={type ?? 'button'}
      {...props}
    >
      {children}
    </button>
  );
});
