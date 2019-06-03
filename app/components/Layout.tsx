import * as React from 'react';
import * as extend from '../styled/extend';
import styled from 'styled-components';
import Sidebar from './Sidebar';

const Box = styled.div`
  ${extend.flexColumn};
  height: 100%;
`;

const Container = styled.div`
  ${extend.hc};
  flex: 1;
`;

const Left = styled.div`
  flex: 1;
  overflow: hidden;
  border-right: 1px solid #eae9e7;
`;

const Right = styled.div`
  flex: 1;
  overflow: hidden;
`;

const Header = styled.div`
  border-bottom: 1px solid #eae9e7;
`;

const View = styled(Box)`
  flex: 1;
`;

function Layout({ children }) {
  return <Box>{children}</Box>;
}

Layout.Header = Header;
Layout.Sidebar = Sidebar;

Layout.Container = Container;
Layout.View = View;
Layout.Left = Left;
Layout.Right = Right;

export default Layout;
