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
  FormControl,
  FormLabel,
  Input,
  Select,
  VStack,
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
  size: number;
  commitHash: string | null;
  commitMessage: string | null;
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

  // Upload form state
  const [uploadKey, setUploadKey] = useState('');
  const [runtimeVersionInput, setRuntimeVersionInput] = useState('');
  const [commitHashInput, setCommitHashInput] = useState('');
  const [commitMessageInput, setCommitMessageInput] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Update groups state
  const [updateGroups, setUpdateGroups] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  const [selectedGroupName, setSelectedGroupName] = useState<string>('');

  useEffect(() => {
    fetchReleases();
    fetch('/api/update-groups')
      .then((r) => r.json())
      .then((data) => {
        setUpdateGroups(data.groups);
        const def = data.groups.find((g: { isDefault: boolean }) => g.isDefault);
        if (def) setSelectedGroupName(def.name);
      });
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('uploadKey', uploadKey);
      formData.append('runtimeVersion', runtimeVersionInput);
      formData.append('commitHash', commitHashInput);
      formData.append('commitMessage', commitMessageInput);
      formData.append('updateGroup', selectedGroupName);
      formData.append('file', uploadFile);
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }
      showToast('Upload successful', 'success');
      setUploadKey('');
      setRuntimeVersionInput('');
      setCommitHashInput('');
      setCommitMessageInput('');
      setUploadFile(null);
      fetchReleases();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

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

            <Box
              as="form"
              onSubmit={handleUpload}
              mt={6}
              mb={8}
              p={6}
              borderWidth={1}
              borderRadius="md"
              maxW="lg">
              <Heading size="sm" mb={4}>
                Upload Release
              </Heading>
              <VStack spacing={3} align="stretch">
                <FormControl isRequired>
                  <FormLabel>Upload Key</FormLabel>
                  <Input
                    type="password"
                    value={uploadKey}
                    onChange={(e) => setUploadKey(e.target.value)}
                    placeholder="Upload key"
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Runtime Version</FormLabel>
                  <Input
                    value={runtimeVersionInput}
                    onChange={(e) => setRuntimeVersionInput(e.target.value)}
                    placeholder="e.g. 1.0.0"
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Commit Hash</FormLabel>
                  <Input
                    value={commitHashInput}
                    onChange={(e) => setCommitHashInput(e.target.value)}
                    placeholder="e.g. abc1234"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Commit Message</FormLabel>
                  <Input
                    value={commitMessageInput}
                    onChange={(e) => setCommitMessageInput(e.target.value)}
                    placeholder="Optional commit message"
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Update group</FormLabel>
                  <Select
                    value={selectedGroupName}
                    onChange={(e) => setSelectedGroupName(e.target.value)}>
                    {updateGroups.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                        {g.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Bundle file</FormLabel>
                  <Input
                    type="file"
                    accept=".zip,.tar,.gz"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    p={1}
                  />
                </FormControl>
                <Button
                  type="submit"
                  colorScheme="blue"
                  isLoading={uploading}
                  loadingText="Uploading...">
                  Upload
                </Button>
              </VStack>
            </Box>

            {loading && <Text>Loading...</Text>}
            {error && <Text color="red.500">{error}</Text>}

            {!loading && !error && (
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Runtime Version</Th>
                    <Th>Update Group</Th>
                    <Th>Commit Hash</Th>
                    <Th>Commit Message</Th>
                    <Th>Timestamp (UTC)</Th>
                    <Th>File Size</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {releases
                    .sort(
                      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                    )
                    .map((release, index) => (
                      <Tr key={index}>
                        <Td>{release.path}</Td>
                        <Td>{release.runtimeVersion}</Td>
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
                            <Text isTruncated w="10rem">
                              {release.commitHash}
                            </Text>
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
                        <Td>{formatFileSize(release.size)}</Td>
                        <Td justifyItems="center">
                          {index === 0 ? (
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
                                          This will promote this release to be the active release
                                          with a new timestamp.
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
                    ))}
                </Tbody>
              </Table>
            )}
          </Flex>
        </Box>
      </Layout>
    </ProtectedRoute>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
