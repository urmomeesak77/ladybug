// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import EmptyState from '../../../src/components/states/EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('tells the visitor there are no memes yet', () => {
    render(<EmptyState />);

    expect(screen.getByText(/no memes yet/i)).toBeTruthy();
  });
});
