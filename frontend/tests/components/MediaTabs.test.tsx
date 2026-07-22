// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import MediaTabs from '../../src/components/MediaTabs';
import type { UploadMode } from '../../src/lib/uploadModel';

afterEach(cleanup);

// A stateful host: MediaTabs is controlled, so the harness owns the selected mode and swaps
// the panel content the way UploadPage does. Lets the test drive real selection changes.
function Harness() {
  const [mode, setMode] = useState<UploadMode>('image');
  return (
    <MediaTabs selected={mode} onSelect={setMode}>
      <p>{mode === 'image' ? 'image panel' : 'youtube panel'}</p>
    </MediaTabs>
  );
}

describe('MediaTabs', () => {
  it('renders exactly two tabs inside a named tablist', () => {
    render(<Harness />);

    expect(screen.getByRole('tablist', { name: 'What are you posting?' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Image', 'YouTube']);
  });

  it('selects Image by default', () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: 'Image' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'YouTube' }).getAttribute('aria-selected')).toBe('false');
  });

  it('renders exactly one tabpanel, labelled by the active tab', () => {
    render(<Harness />);

    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toBe('image panel');
    // The one panel is named by the selected tab (aria-labelledby → the Image tab's id).
    expect(screen.getByRole('tabpanel', { name: 'Image' })).toBeTruthy();
  });

  it('flips aria-selected and swaps the panel when a tab is clicked', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('tab', { name: 'YouTube' }));

    expect(screen.getByRole('tab', { name: 'YouTube' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Image' }).getAttribute('aria-selected')).toBe('false');
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toBe('youtube panel');
  });

  it('gives only the selected tab a tabindex of 0 (roving)', () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: 'Image' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'YouTube' }).getAttribute('tabindex')).toBe('-1');
  });
});
