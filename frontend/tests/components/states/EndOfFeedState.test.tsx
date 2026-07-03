// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import EndOfFeedState from '../../../src/components/states/EndOfFeedState';

afterEach(cleanup);

describe('EndOfFeedState', () => {
  it('marks the end of the feed', () => {
    render(<EndOfFeedState />);

    expect(screen.getByText(/reached the end/i)).toBeTruthy();
  });
});
