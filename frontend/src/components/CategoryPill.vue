<template>
  <span class="gh-pill" :class="color ? `text-${color}` : ''" :style="color ? 'border-color: currentColor' : ''">
    <slot />
  </span>
</template>

<script setup lang="ts">
// 탑바(MainLayout.vue)의 역할/공개여부 뱃지는 둥근 알약 모양(.gh-pill,
// app.scss)인데, 콘텐츠 영역의 카테고리 태그(질문/답변/의견 종류,
// collaborator 역할, PR 파일 상태 등)는 전부 Quasar 기본 q-badge라
// 서로 다른 두 뱃지 체계처럼 보였다 - 프론트엔드 일관성 3라운드에서
// 설계자에게 확인 후 도입. 기존 `.gh-pill`의 모양(둥근 외곽선, 무채색
// 기본값)은 그대로 두고, `color` prop이 있으면 Quasar named color
// 유틸리티 클래스(`text-<color>`)로 글자색을 입히고 테두리는
// `border-color: currentColor`로 글자색을 그대로 따라가게 해서 -
// 기존 q-badge outline이 하던 "색으로 의미 구분"을 그대로 유지한다
// (color 미지정 시 탑바와 동일한 무채색 pill).
defineProps<{ color?: string }>();
</script>
