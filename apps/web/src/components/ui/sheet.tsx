'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

// Minimal shadcn-style Sheet (right slide-over) over Radix Dialog. Accessible by construction
// (focus trap, Esc, aria). Styled with the locked light-glass tokens via globals.css.
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="sheet glass" data-sheet>
          <div className="sheet-head">
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            <Dialog.Close className="sheet-close" aria-label="Close">
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          {description ? <Dialog.Description className="sheet-desc">{description}</Dialog.Description> : null}
          <div className="sheet-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
