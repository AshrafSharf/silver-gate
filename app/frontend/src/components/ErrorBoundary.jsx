import { Component } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * ErrorBoundary - Catches render errors in its subtree and shows a fallback
 * instead of unmounting the whole React app.
 *
 * @param {string} message - Fallback message to display
 * @param {React.ReactNode} children
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{this.props.message || 'Something went wrong rendering this content.'}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
