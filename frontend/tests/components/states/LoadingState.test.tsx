// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import LoadingState from '../../../src/components/states/LoadingState';

afterEach(cleanup);

describe('LoadingState', () => {
  it('signals that a batch is in flight', () => {
    render(<LoadingState />);

    expect(screen.getByText(/loading/i)).toBeTruthy();
  });
});
