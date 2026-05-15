import type { Document, StatusCounts } from './types/document'

export const MOCK_DOCUMENTS: Document[] = [
  {
    id: 'doc-001',
    file_path: 'input_documents/project-requirements.pdf',
    content_summary: 'Tài liệu mô tả yêu cầu nghiệp vụ cho hệ thống quản lý tri thức nội bộ.',
    status: 'processed',
    content_length: 24580,
    chunks_count: 42,
    created_at: '2026-05-10T08:30:00Z',
    updated_at: '2026-05-10T08:35:21Z',
  },
  {
    id: 'doc-002',
    file_path: 'input_documents/architecture-design.md',
    content_summary: 'Tổng quan kiến trúc hệ thống, bao gồm các thành phần chính và luồng dữ liệu.',
    status: 'processed',
    content_length: 18320,
    chunks_count: 31,
    created_at: '2026-05-11T09:00:00Z',
    updated_at: '2026-05-11T09:04:45Z',
  },
  {
    id: 'doc-003',
    file_path: 'input_documents/api-reference.docx',
    content_summary: 'Tài liệu tham chiếu API đầy đủ, bao gồm các endpoint, request/response schema.',
    status: 'processed',
    content_length: 31200,
    chunks_count: 58,
    created_at: '2026-05-11T14:15:00Z',
    updated_at: '2026-05-11T14:22:10Z',
  },
  {
    id: 'doc-004',
    file_path: 'input_documents/onboarding-guide.txt',
    content_summary: 'Hướng dẫn onboarding cho thành viên mới, bao gồm quy trình làm việc và các công cụ sử dụng.',
    status: 'processed',
    content_length: 9870,
    chunks_count: 17,
    created_at: '2026-05-12T10:00:00Z',
    updated_at: '2026-05-12T10:02:30Z',
  },
  {
    id: 'doc-005',
    file_path: 'input_documents/meeting-notes-q2.md',
    content_summary: 'Biên bản họp Q2 2026, tổng kết tiến độ dự án và các quyết định kỹ thuật quan trọng.',
    status: 'processed',
    content_length: 7430,
    chunks_count: 13,
    created_at: '2026-05-13T07:45:00Z',
    updated_at: '2026-05-13T07:47:55Z',
  },
]

export const MOCK_STATUS_COUNTS: StatusCounts = {
  all: 5,
  processed: 5,
  preprocessed: 0,
  processing: 0,
  pending: 0,
  failed: 0,
}
