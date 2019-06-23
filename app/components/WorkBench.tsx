import * as React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  width: 200px;
  border-right: 1px solid #eae9e7;
`;

// <WorkBench>
//   <WorkBench.Panel title="ONE" icon"One">
//      panel one
//   </WorkBench.Panel>
//   <WorkBench.Panel title="TWO" icon="Two">
//     panel two
//   </WorkBench.Panel>
// </WorkBench>

function WorkBench({ children }) {
  return <Container>{children}</Container>;
}

export default WorkBench;
