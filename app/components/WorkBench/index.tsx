import * as React from 'react';
import styled from 'styled-components';
import { useMappedState } from 'redux-react-hook';
import { blockVisiable, VisableProps } from '../../styled/mixin';

import { Explorer } from './modules';

const Container = styled.div<VisableProps>`
  width: 200px;
  border-right: 1px solid #eae9e7;
  ${props => blockVisiable(props)};
`;

const TitleBar = styled.div`
  padding: 10px 15px;
  border-bottom: 1px solid #eae9e7;
  text-transform: uppercase;
`;

const WorkBenchMap = {
  Explorer: <Explorer />,
  'Export To PDF': 'Export To PDF',
  'Full Screen': 'Full Screen',
  Search: 'Search',
  'Source Control': 'Source Control'
};

function WorkBench() {
  const { visible, title } = useMappedState(({ Workbench: Wb }) => ({
    visible: Wb.visible,
    title: Wb.title
  }));

  return (
    <Container show={visible}>
      <TitleBar>{title}</TitleBar>
      {WorkBenchMap[title]}
    </Container>
  );
}

export default WorkBench;
