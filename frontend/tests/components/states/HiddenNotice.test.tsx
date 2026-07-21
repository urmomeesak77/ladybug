// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import HiddenNotice from '../../../src/components/states/HiddenNotice';

afterEach(cleanup);

describe('HiddenNotice', () => {
  it('shows a pending message inside a status region', () => {
    render(<HiddenNotice status="pending" />);

    const region = screen.getByRole('status');
    expect(region.textContent).toMatch(/pending review/i);
    expect(region.textContent).toMatch(/publicly visible/i);
  });

  it('shows a deleted message', () => {
    render(<HiddenNotice status="deleted" />);

    expect(screen.getByRole('status').textContent).toMatch(/deleted/i);
  });
});
