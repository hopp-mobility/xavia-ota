import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  Heading,
  Button,
  Tag,
  HStack,
  IconButton,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  Flex,
  Tooltip,
  Badge,
  FormLabel,
  Select,
} from '@chakra-ui/react';
import moment from 'moment';
import { useEffect, useRef, useState } from 'react';
import { SlRefresh } from 'react-icons/sl';

import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';
import { showToast } from '../components/toast';

interface Release {
  path: string;
  runtimeVersion: string;
  timestamp: string;
  commitHash: string | null;
  commitMessage: string | null;
  updateId?: string;
  updateGroupId?: string;
  updateGroupName?: string;
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [updateGroups, setUpdateGroups] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  const [filterGroupName, setFilterGroupName] = useState<string>(''); // '' = all groups

  useEffect(() => {
    fetchReleases();
    fetch('/api/update-groups')
      .then((r) => r.json())
      .then((data) => setUpdateGroups(data.groups ?? []))
      .catch(() => setUpdateGroups([]));
  }, []);

  const fetchReleases = async () => {
    try {
      const response = await fetch('/api/releases');
      if (!response.ok) {
        throw new Error('Failed to fetch releases');
      }
      const data = await response.json();
      setReleases(data.releases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch releases');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <Layout>
        <Box mx={4}>
          <Flex className="flex-col">
            <HStack>
              <Heading size="lg">Releases</Heading>
              <IconButton
                aria-label="Refresh"
                onClick={fetchReleases}
                variant="solid"
                // colorScheme="blue"
                size="md"
                icon={<SlRefresh />}
              />
            </HStack>

            {loading && <Text>Loading...</Text>}
            {error && <Text color="red.500">{error}</Text>}

            {!loading && !error && (
              <>
                <HStack mb={4}>
                  <FormLabel mb={0}>Filter by group:</FormLabel>
                  <Select
                    width="auto"
                    value={filterGroupName}
                    onChange={(e) => setFilterGroupName(e.target.value)}>
                    <option value="">All groups</option>
                    {updateGroups.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                        {g.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </Select>
                </HStack>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Update ID</Th>
                      <Th>Runtime Version</Th>
                      <Th>Update Group</Th>
                      <Th>Commit Hash</Th>
                      <Th>Commit Message</Th>
                      <Th>Timestamp (UTC)</Th>
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {(() => {
                      // The active release is per update group — clients on
                      // group X resolve to the latest row tagged X, regardless
                      // of how recent rows in other groups are.
                      const latestByGroup = new Map<string, Release>();
                      for (const r of releases) {
                        if (!r.updateGroupId) continue;
                        const existing = latestByGroup.get(r.updateGroupId);
                        if (
                          !existing ||
                          new Date(r.timestamp).getTime() > new Date(existing.timestamp).getTime()
                        ) {
                          latestByGroup.set(r.updateGroupId, r);
                        }
                      }
                      const activeReleasePaths = new Set(
                        Array.from(latestByGroup.values()).map((r) => r.path)
                      );

                      const visibleReleases = filterGroupName
                        ? releases.filter((r) => r.updateGroupName === filterGroupName)
                        : releases;
                      return visibleReleases
                        .sort(
                          (a, b) =>
                            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                        )
                        .map((release, index) => (
                          <Tr key={index}>
                            <Td>
                              <Tooltip label={release.updateId}>
                                <Text>{release.updateId?.slice(0, 7)}</Text>
                              </Tooltip>
                            </Td>
                            <Td>
                              <Tooltip label={release.runtimeVersion}>
                                <Text>{release.runtimeVersion.slice(0, 7)}</Text>
                              </Tooltip>
                            </Td>
                            <Td>
                              {release.updateGroupName && (
                                <Badge
                                  colorScheme={
                                    release.updateGroupName === 'production' ? 'green' : 'purple'
                                  }>
                                  {release.updateGroupName}
                                </Badge>
                              )}
                            </Td>
                            <Td>
                              <Tooltip label={release.commitHash}>
                                <Text>{release.commitHash?.slice(0, 7)}</Text>
                              </Tooltip>
                            </Td>
                            <Td>
                              <Tooltip label={release.commitMessage}>
                                <Text isTruncated w="10rem">
                                  {release.commitMessage}
                                </Text>
                              </Tooltip>
                            </Td>
                            <Td className="min-w-[14rem]">
                              {moment(release.timestamp).utc().format('MMM, Do  HH:mm')}
                            </Td>
                            <Td justifyItems="center">
                              {activeReleasePaths.has(release.path) ? (
                                <Tag size="lg" colorScheme="green">
                                  Active Release
                                </Tag>
                              ) : (
                                <Button
                                  variant="solid"
                                  colorScheme="orange"
                                  size="sm"
                                  onClick={async () => {
                                    setIsOpen(true);
                                    setSelectedRelease(release);
                                  }}>
                                  <AlertDialog
                                    isOpen={isOpen}
                                    leastDestructiveRef={cancelRef}
                                    onClose={() => setIsOpen(false)}
                                    isCentered>
                                    <AlertDialogOverlay>
                                      <AlertDialogContent>
                                        <AlertDialogHeader fontSize="lg" fontWeight="bold">
                                          Rollback Release
                                        </AlertDialogHeader>

                                        <AlertDialogBody>
                                          Are you sure you want to rollback to this release?
                                          <Tag
                                            size="lg"
                                            colorScheme="green"
                                            mt={4}
                                            padding={4}
                                            className="w-full">
                                            <Text fontSize="sm">
                                              Commit Hash: {selectedRelease?.commitHash}
                                            </Text>
                                          </Tag>
                                          <Tag size="lg" colorScheme="orange" mt={4} padding={4}>
                                            <Text fontSize="sm">
                                              This will promote this release to be the active
                                              release with a new timestamp.
                                            </Text>
                                          </Tag>
                                        </AlertDialogBody>

                                        <AlertDialogFooter>
                                          <Button ref={cancelRef} onClick={() => setIsOpen(false)}>
                                            Cancel
                                          </Button>
                                          <Button
                                            colorScheme="red"
                                            onClick={async () => {
                                              const response = await fetch('/api/rollback', {
                                                method: 'POST',
                                                headers: {
                                                  'Content-Type': 'application/json',
                                                },
                                                body: JSON.stringify({
                                                  path: selectedRelease?.path,
                                                  runtimeVersion: selectedRelease?.runtimeVersion,
                                                  commitHash: selectedRelease?.commitHash,
                                                  commitMessage: selectedRelease?.commitMessage,
                                                }),
                                              });

                                              if (!response.ok) {
                                                throw new Error('Rollback failed');
                                              }

                                              showToast('Rollback successful', 'success');
                                              fetchReleases();
                                              setIsOpen(false);
                                            }}
                                            ml={3}>
                                            Rollback
                                          </Button>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialogOverlay>
                                  </AlertDialog>
                                  Rollback to this release
                                </Button>
                              )}
                            </Td>
                          </Tr>
                        ));
                    })()}
                  </Tbody>
                </Table>
              </>
            )}
          </Flex>
        </Box>
      </Layout>
    </ProtectedRoute>
  );
}

