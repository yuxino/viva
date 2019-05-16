import * as React from 'react';
import Left from './Left';
import Right from './Right';

function Layout({ children }) {
  return <div>{children}</div>;
}

Layout.Left = Left;
Layout.Right = Right;

export default Layout;
