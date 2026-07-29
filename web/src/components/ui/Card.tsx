import { ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}

export default function Card({ title, children, className = '', headerAction }: CardProps) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border ${className}`}>
      {(title || headerAction) && (
        <div className="px-6 py-4 border-b flex items-center justify-between">
          {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
          {headerAction}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}
