import * as React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  border-bottom: 1px solid #eae9e7;
  display: flex;
`;

const Tab = styled.div`
  padding: 10px 15px;
  border-right: 1px solid #eae9e7;
  user-select: none;
`;

export default function Tabs() {
  return (
    <Container>
      <Tab>Tabs.md</Tab>
      <Tab>MdeEditor.md</Tab>
      <Tab>APP.md</Tab>
    </Container>
  );
}
