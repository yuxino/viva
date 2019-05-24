import * as React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  border-right: 1px solid #eae9e7;
  padding: 20px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const IconGroup = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`;

const IconGroupItem = styled.li`
  & + & {
    margin-top: 15px;
  }
  padding: 10px 15px;
`;

const Icon = styled.i`
  font-size: 20px;
  color: #8c8c8c;
`;

function Sidebar() {
  return (
    <Container>
      <IconGroup>
        <IconGroupItem>
          <Icon className="far fa-copy" />
        </IconGroupItem>
        <IconGroupItem>
          <Icon className="fas fa-code-branch" />
        </IconGroupItem>
        <IconGroupItem>
          <Icon className="fas fa-search" />
        </IconGroupItem>
        <IconGroupItem>
          <Icon className="far fa-file-pdf" />
        </IconGroupItem>
      </IconGroup>

      <IconGroup>
        <IconGroupItem>
          <Icon className="fas fa-cog" />
        </IconGroupItem>
      </IconGroup>
    </Container>
  );
}

export default Sidebar;
