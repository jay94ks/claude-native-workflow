// 배치 6b(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 문서 정리용 개인 폴더(웹 전용) + 문서 즐겨찾기. server.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  listFolders,
  listFolderDocuments,
  listFolderDocumentsPaged,
  listUnfiledDocuments,
  listUnfiledDocumentsPaged,
  moveDocumentToFolder,
  type FolderDetail,
} from "../../core/folders.js";
import { isDocumentFavorited, setDocumentFavorite, listFavoriteDocumentsPaged } from "../../core/documentFavorites.js";
import { getDocumentAccessInfo } from "../../core/documents.js";
import { resolveEffectivePermission } from "../../core/permissions.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute, parseDocumentSort } from "../shared.js";

const router = Router();

// 폴더는 만든 설계자 개인 소유라(core/folders.ts) 프로젝트 멤버면(viewer
// 포함) 누구나 자기 폴더를 만들고 관리할 수 있다 - 소유권 확인은 core
// 함수 내부에서 한다.

router.post(
  "/api/projects/:projectId/folders",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { name, parentFolderId } = req.body as { name?: string; parentFolderId?: string };
    assertTruthy(name, "name이 필요합니다");
    res.json(await createFolder(req.params.projectId, name, parentFolderId, req.userId!));
  }),
);

router.put(
  "/api/folders/:folderId",
  authenticate,
  asyncRoute(async (req, res) => {
    const { name, parentFolderId, siblingOrder } = req.body as {
      name?: string;
      parentFolderId?: string | null;
      siblingOrder?: string[];
    };
    let result: FolderDetail | undefined;
    if (name !== undefined) {
      result = await renameFolder(req.params.folderId, name, req.userId!);
    }
    if (parentFolderId !== undefined) {
      if (!Array.isArray(siblingOrder)) { res.status(400).json({ error: "siblingOrder가 필요합니다" }); return; }
      result = await moveFolder(req.params.folderId, req.userId!, parentFolderId, siblingOrder);
    }
    assertTruthy(result, "name 또는 parentFolderId가 필요합니다");
    res.json(result);
  }),
);

router.delete(
  "/api/folders/:folderId",
  authenticate,
  asyncRoute(async (req, res) => {
    const mode = req.query.mode as string | undefined;
    if (mode !== undefined && mode !== "recursive" && mode !== "promote") {
      res.status(400).json({ error: "mode는 recursive/promote 중 하나여야 합니다" });
      return;
    }
    await deleteFolder(req.params.folderId, req.userId!, mode as "recursive" | "promote" | undefined);
    res.json({ ok: true });
  }),
);

router.get(
  "/api/projects/:projectId/folders",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listFolders(req.params.projectId, req.userId!));
  }),
);

router.get(
  "/api/folders/:folderId/documents",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listFolderDocuments(req.params.folderId, req.userId!));
  }),
);

// "문서" 탭 "폴더" 서브탭 우측 목록 페이지네이션(#documents-tab-redesign).
router.get(
  "/api/folders/:folderId/documents/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(
      await listFolderDocumentsPaged(
        req.params.folderId,
        req.userId!,
        page,
        pageSize,
        parseDocumentSort(req.query.sort) ?? "createdAt:desc",
      ),
    );
  }),
);

router.get(
  "/api/projects/:projectId/documents/unfiled",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listUnfiledDocuments(req.params.projectId, req.userId!));
  }),
);

router.get(
  "/api/projects/:projectId/documents/unfiled/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(
      await listUnfiledDocumentsPaged(
        req.params.projectId,
        req.userId!,
        page,
        pageSize,
        parseDocumentSort(req.query.sort) ?? "createdAt:desc",
      ),
    );
  }),
);

// 프로젝트 홈 "즐겨찾기한 문서" 섹션 + "더보기" 전용 페이지가 공유
// (#document-favorites).
router.get(
  "/api/projects/:projectId/documents/favorites/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(
      await listFavoriteDocumentsPaged(
        req.params.projectId,
        req.userId!,
        page,
        pageSize,
        parseDocumentSort(req.query.sort) ?? "createdAt:desc",
      ),
    );
  }),
);

router.put(
  "/api/documents/:trackingCode/folder",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    // 개인 폴더 배치는 문서 내용을 안 바꾸는 순수 메타데이터라 read
    // 권한이면 충분하다(write 요구 안 함).
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { folderId } = req.body as { folderId?: string | null };
    await moveDocumentToFolder(req.params.trackingCode, folderId ?? null, req.userId!);
    res.json({ ok: true });
  }),
);

// 문서 즐겨찾기(#document-favorites) - 폴더 라우트와 같은 권한 원칙
// (개인 메타데이터라 read 권한이면 충분, write 요구 안 함).
router.get(
  "/api/documents/:trackingCode/favorite",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    res.json({ favorited: await isDocumentFavorited(req.params.trackingCode, req.userId!) });
  }),
);

router.put(
  "/api/documents/:trackingCode/favorite",
  authenticate,
  asyncRoute(async (req, res) => {
    const doc = await getDocumentAccessInfo(req.params.trackingCode);
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const perm = await resolveEffectivePermission(doc.projectId, req.userId!, { docTypeId: doc.docTypeId, documentId: doc.id });
    if (!perm.read) { res.status(403).json({ error: "이 문서에 대한 읽기 권한이 없습니다" }); return; }
    const { favorited } = req.body as { favorited: boolean };
    await setDocumentFavorite(req.params.trackingCode, req.userId!, !!favorited);
    res.json({ ok: true });
  }),
);

export default router;
