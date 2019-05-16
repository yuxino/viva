import * as React from 'react';
import Left from './Left';
import Right from './Right';
// import './index.scss';

function Layout({ children }) {
  return <div className="bb">{children}</div>;
}

Layout.Left = Left;
Layout.Right = Right;

export default Layout;
