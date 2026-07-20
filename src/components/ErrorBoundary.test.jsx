import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

const ProblematicComponent = () => {
  throw new Error('Test error');
};

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Happy path content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Happy path content')).toBeInTheDocument();
  });

  it('renders fallback error message when child throws an error', () => {
    // Suppress console.error output for expected error throw
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblematicComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
