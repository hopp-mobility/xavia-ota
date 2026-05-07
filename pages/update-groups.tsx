import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Input,
  List,
  ListItem,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';

import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';
import { showToast } from '../components/toast';

type UpdateGroup = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
};

type Member = { updateGroupId: string; userId: string; createdAt: string };

export default function UpdateGroupsPage() {
  const [groups, setGroups] = useState<UpdateGroup[] | null>(null);
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<UpdateGroup | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [newMemberId, setNewMemberId] = useState('');

  async function refreshGroups() {
    const res = await fetch('/api/update-groups');
    const json = await res.json();
    setGroups(json.groups);
  }

  async function refreshMembers(group: UpdateGroup) {
    const res = await fetch(`/api/update-groups/${group.id}/members`);
    const json = await res.json();
    setMembers(json.members);
  }

  useEffect(() => {
    refreshGroups();
  }, []);
  useEffect(() => {
    if (selected) refreshMembers(selected);
  }, [selected]);

  async function createGroup() {
    if (!newName.trim()) return;
    const res = await fetch('/api/update-groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      showToast('Failed to create group', 'error');
      return;
    }
    setNewName('');
    showToast('Group created', 'success');
    refreshGroups();
  }

  async function deleteGroup(group: UpdateGroup) {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    const res = await fetch(`/api/update-groups/${group.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error ?? 'Failed to delete group', 'error');
      return;
    }
    if (selected?.id === group.id) setSelected(null);
    refreshGroups();
  }

  async function addMember() {
    if (!selected || !newMemberId.trim()) return;
    const res = await fetch(`/api/update-groups/${selected.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: newMemberId.trim() }),
    });
    if (!res.ok) {
      showToast('Failed to add member', 'error');
      return;
    }
    setNewMemberId('');
    refreshMembers(selected);
  }

  async function removeMember(userId: string) {
    if (!selected) return;
    const res = await fetch(
      `/api/update-groups/${selected.id}/members?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      showToast('Failed to remove member', 'error');
      return;
    }
    refreshMembers(selected);
  }

  return (
    <ProtectedRoute>
      <Layout>
        <Heading mb={6}>Update Groups</Heading>
        <Flex gap={8} align="flex-start">
          <Box flex="1">
            <Heading size="md" mb={3}>
              Groups
            </Heading>
            {groups === null ? (
              <Spinner />
            ) : (
              <List spacing={2}>
                {groups.map((g) => (
                  <ListItem
                    key={g.id}
                    p={3}
                    borderWidth="1px"
                    borderRadius="md"
                    cursor="pointer"
                    bg={selected?.id === g.id ? 'gray.50' : undefined}
                    onClick={() => setSelected(g)}>
                    <HStack justify="space-between">
                      <Text fontWeight="medium">
                        {g.name}
                        {g.isDefault ? ' (default)' : ''}
                      </Text>
                      {!g.isDefault && (
                        <Button
                          size="xs"
                          colorScheme="red"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteGroup(g);
                          }}>
                          Delete
                        </Button>
                      )}
                    </HStack>
                  </ListItem>
                ))}
              </List>
            )}
            <HStack mt={4}>
              <Input
                placeholder="New group name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button onClick={createGroup}>Create</Button>
            </HStack>
          </Box>

          <Box flex="1">
            <Heading size="md" mb={3}>
              {selected ? `Members of "${selected.name}"` : 'Select a group'}
            </Heading>
            {selected && (
              <VStack align="stretch" spacing={2}>
                {selected.isDefault ? (
                  <Text color="gray.600">
                    The default group has implicit membership — every user is in it.
                  </Text>
                ) : (
                  <>
                    {members.length === 0 ? (
                      <Text color="gray.600">No members yet.</Text>
                    ) : (
                      <List spacing={2}>
                        {members.map((m) => (
                          <ListItem key={m.userId} p={2} borderWidth="1px" borderRadius="md">
                            <HStack justify="space-between">
                              <Text>{m.userId}</Text>
                              <Button
                                size="xs"
                                colorScheme="red"
                                onClick={() => removeMember(m.userId)}>
                                Remove
                              </Button>
                            </HStack>
                          </ListItem>
                        ))}
                      </List>
                    )}
                    <HStack>
                      <Input
                        placeholder="User id"
                        value={newMemberId}
                        onChange={(e) => setNewMemberId(e.target.value)}
                      />
                      <Button onClick={addMember}>Add</Button>
                    </HStack>
                  </>
                )}
              </VStack>
            )}
          </Box>
        </Flex>
      </Layout>
    </ProtectedRoute>
  );
}
