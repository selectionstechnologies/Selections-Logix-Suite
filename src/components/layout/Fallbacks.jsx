import { Component } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, Compass, Lock } from 'lucide-react';
import { EmptyState } from '../ui/index.jsx';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Screen crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card m-4">
        <EmptyState
          icon={AlertOctagon}
          title="Something went wrong on this screen"
          message={this.state.error.message}
          action={<button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>}
        />
      </div>
    );
  }
}

export const Forbidden = () => (
  <div className="card">
    <EmptyState icon={Lock} title="You do not have access to this screen" message="Your role does not include this module. Ask an administrator, or switch role from the profile menu." action={<Link className="btn-primary" to="/">Back to dashboard</Link>} />
  </div>
);

export const NotFound = () => (
  <div className="card">
    <EmptyState icon={Compass} title="Page not found" message="That address does not match any screen." action={<Link className="btn-primary" to="/">Back to dashboard</Link>} />
  </div>
);

export const RecordNotFound = ({ what = 'Record', backTo, backLabel = 'Go back' }) => (
  <div className="card">
    <EmptyState icon={Compass} title={`${what} not found`} message="It may have been removed, or it is outside your account." action={<Link className="btn-primary" to={backTo}>{backLabel}</Link>} />
  </div>
);
