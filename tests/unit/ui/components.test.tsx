// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AppProvider,
  useExportEvidence,
  useSession,
} from '../../../src/app/app-provider';
import { CodeBlock } from '../../../src/components/code-block';
import { Dialog, ModalSurface } from '../../../src/components/dialog';
import { ResizeSeparator } from '../../../src/components/resizable';
import { Tabs } from '../../../src/components/tabs';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { createSession } from '../../../src/domain/session';
import type { SessionController } from '../../../src/features/session/session-controller';

function controllerFake(): SessionController {
  const snapshot = redactSession(
    createSession('tab-1', 'https://app.test', 1_000),
    DEFAULT_REDACTION_CONFIG,
  );
  return {
    async start() {},
    async stop() {},
    async clear() {},
    async setRetention() {},
    async accept() {},
    acceptInteraction() {},
    warn() {},
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
  };
}

describe('code block', () => {
  it('omits the accessible label when none is supplied', () => {
    const { container } = render(<CodeBlock>{'{"a":1}'}</CodeBlock>);

    const block = container.querySelector('pre')!;
    expect(block).not.toHaveAttribute('aria-label');
    expect(block).toHaveClass('code-block');
    expect(block).not.toHaveClass('code-block--wrap');
  });

  it('labels and wraps long evidence when requested', () => {
    render(
      <CodeBlock label="Structured body" wrap>
        {'{"a":1}'}
      </CodeBlock>,
    );

    const block = screen.getByLabelText('Structured body');
    expect(block).toHaveClass('code-block--wrap');
  });
});

describe('tab list keyboard contract', () => {
  const tabs = [
    { id: 'one' as const, label: 'One', content: <p>First panel</p> },
    { id: 'two' as const, label: 'Two', content: <p>Second panel</p> },
    { id: 'three' as const, label: 'Three', content: <p>Third panel</p> },
  ];

  it('moves with arrows and jumps with Home and End', async () => {
    const user = userEvent.setup();
    render(<Tabs defaultActiveId="one" label="Evidence" tabs={tabs} />);

    await user.click(screen.getByRole('tab', { name: 'One' }));
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('ignores unrelated keys instead of changing the selection', async () => {
    const user = userEvent.setup();
    render(<Tabs defaultActiveId="two" label="Evidence" tabs={tabs} />);

    await user.click(screen.getByRole('tab', { name: 'Two' }));
    await user.keyboard('a');

    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reports the selected tab to a controlling parent without owning state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Tabs
        activeId="one"
        defaultActiveId="one"
        label="Evidence"
        onChange={onChange}
        tabs={tabs}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Two' }));

    expect(onChange).toHaveBeenCalledWith('two');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('renders nothing when no tabs are supplied', () => {
    const { container } = render(
      <Tabs defaultActiveId="one" label="Evidence" tabs={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('resize separator', () => {
  it('adjusts with arrows, larger shift steps, Home, and End', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ResizeSeparator
        label="Resize ledger"
        max={600}
        min={200}
        onChange={onChange}
        value={300}
      />,
    );

    const separator = screen.getByRole('separator', { name: 'Resize ledger' });
    separator.focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(308);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(292);

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith(332);

    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(200);

    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(600);
  });

  it('ignores unrelated keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ResizeSeparator
        label="Resize ledger"
        max={600}
        min={200}
        onChange={onChange}
        value={300}
      />,
    );

    screen.getByRole('separator', { name: 'Resize ledger' }).focus();
    await user.keyboard('x');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps pointer drags between the minimum and maximum', () => {
    const onChange = vi.fn();
    render(
      <ResizeSeparator
        label="Resize ledger"
        max={600}
        min={200}
        onChange={onChange}
        value={300}
      />,
    );
    const separator = screen.getByRole('separator', { name: 'Resize ledger' });

    separator.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 100 }),
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140 }));
    expect(onChange).toHaveBeenLastCalledWith(340);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5_000 }));
    expect(onChange).toHaveBeenLastCalledWith(600);

    window.dispatchEvent(new PointerEvent('pointerup', {}));
    onChange.mockClear();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('modal focus containment', () => {
  it('keeps Tab inside the panel when it holds no focusable nodes', async () => {
    const user = userEvent.setup();
    render(
      <ModalSurface
        backdropClassName="test-backdrop"
        label="Empty surface"
        onClose={() => undefined}
        panelClassName="test-panel"
      >
        <p>No controls here</p>
      </ModalSurface>,
    );

    const panel = screen.getByRole('dialog', { name: 'Empty surface' });
    panel.focus();
    await user.keyboard('{Tab}');

    expect(panel).toHaveFocus();
  });

  it('wraps focus forward from the last control to the first', async () => {
    const user = userEvent.setup();
    render(
      <Dialog description="Two controls" onClose={() => undefined} title="Wrap test">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    screen.getByRole('button', { name: 'Last' }).focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });
});

describe('application services provider', () => {
  it('provides a no-op export when the host supplies none', async () => {
    function Probe() {
      const exportEvidence = useExportEvidence();
      const session = useSession();
      return (
        <button onClick={() => void exportEvidence()} type="button">
          {session.origin}
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <AppProvider controller={controllerFake()}>
        <Probe />
      </AppProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'https://app.test' }));
    expect(screen.getByRole('button', { name: 'https://app.test' })).toBeVisible();
  });

  it('refuses to serve application services outside the provider', () => {
    function Orphan() {
      useSession();
      return null;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Orphan />)).toThrow('Payloadra app services are unavailable.');

    consoleError.mockRestore();
  });
});

describe('modal surface variants', () => {
  it('dismisses on backdrop press only when the host allows it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalSurface
        backdropClassName="surface-backdrop"
        label="Sticky surface"
        onClose={onClose}
        panelClassName="surface-panel"
      >
        <button type="button">Inside</button>
      </ModalSurface>,
    );

    await user.click(document.querySelector('.surface-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <ModalSurface
        backdropClassName="surface-backdrop"
        dismissOnBackdrop
        label="Dismissable surface"
        onClose={onClose}
        panelClassName="surface-panel"
      >
        <button type="button">Inside</button>
      </ModalSurface>,
    );
    await user.click(document.querySelector('.surface-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a press that starts inside the panel from closing the surface', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ModalSurface
        backdropClassName="surface-backdrop"
        dismissOnBackdrop
        label="Dismissable surface"
        onClose={onClose}
        panelClassName="surface-panel"
      >
        <button type="button">Inside</button>
      </ModalSurface>,
    );

    await user.click(screen.getByRole('button', { name: 'Inside' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('labels itself through an external element when asked', () => {
    render(
      <>
        <h2 id="surface-title">External title</h2>
        <p id="surface-description">External description</p>
        <ModalSurface
          backdropClassName="surface-backdrop"
          describedBy="surface-description"
          labelledBy="surface-title"
          onClose={() => undefined}
          panelClassName="surface-panel"
        >
          <button type="button">Inside</button>
        </ModalSurface>
      </>,
    );

    const panel = screen.getByRole('dialog', { name: 'External title' });
    expect(panel).toHaveAttribute('aria-describedby', 'surface-description');
  });

  it('closes on Escape from inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog description="Escape test" onClose={onClose} title="Escape dialog">
        <button type="button">Inside</button>
      </Dialog>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('dialog composition', () => {
  it('omits the description association when no description is given', () => {
    render(
      <Dialog onClose={() => undefined} title="Plain dialog">
        <button type="button">Only</button>
      </Dialog>,
    );

    const panel = screen.getByRole('dialog', { name: 'Plain dialog' });
    expect(panel).not.toHaveAttribute('aria-describedby');
  });

  it('lets Tab move between interior controls without wrapping', async () => {
    const user = userEvent.setup();
    render(
      <Dialog description="Three controls" onClose={() => undefined} title="Middle">
        <button type="button">First</button>
        <button type="button">Middle</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    screen.getByRole('button', { name: 'Middle' }).focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();

    screen.getByRole('button', { name: 'Middle' }).focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });
});
