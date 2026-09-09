<script setup lang="ts">
import { ref, watch } from "vue";
import { client, type PendingItem, type DocDetail } from "../api";

const props = defineProps<{ modelValue: boolean; item: PendingItem | null; currentDocLinks: string[] }>();
const emit = defineEmits<{ "update:modelValue": [boolean]; submitted: [] }>();

const answer = ref("");
const linkedDocs = ref<DocDetail[]>([]);
const submitting = ref(false);

// docs/PROTOCOL.md 4절 "- 권장:/- 대안:" 표기 - 원클릭으로 답변란 채우기.
// "관련 문서 참고"는 질문지 원문이 아니라 이 문서가 links로 연결한 다른
// 문서(SP/DS/PL/DC 등)를 보여주는 것 - 답변에 필요한 배경 자료.
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    answer.value = "";
    linkedDocs.value = [];
    const results = await Promise.all(
      props.currentDocLinks.map(async (id) => {
        try {
          return await client.search(id).then((r) => r[0]?.path);
        } catch {
          return undefined;
        }
      }),
    );
    const paths = results.filter((p): p is string => !!p);
    linkedDocs.value = await Promise.all(paths.map((p) => client.doc(p)));
  },
);

async function submit() {
  if (!props.item || !answer.value.trim()) return;
  submitting.value = true;
  try {
    await client.reply(props.item.doc_path, props.item.question_id, answer.value.trim());
    emit("submitted");
    emit("update:modelValue", false);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v) => emit('update:modelValue', v)">
    <q-card style="width: min(720px, 92vw); max-width: 92vw">
      <q-card-section>
        <div class="text-subtitle2 text-grey-7">{{ item?.doc_id }} · Q{{ item?.question_id }}</div>
        <div class="text-body1 text-weight-medium">{{ item?.question }}</div>
      </q-card-section>

      <q-card-section v-if="item?.options.length" class="q-pt-none">
        <q-btn
          v-for="(opt, i) in item.options"
          :key="i"
          :label="`${opt.kind}: ${opt.text}`"
          :color="opt.kind === '권장' ? 'primary' : 'grey-7'"
          :outline="opt.kind !== '권장'"
          size="sm"
          class="q-mr-sm q-mb-sm"
          @click="answer = opt.text"
        />
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input v-model="answer" type="textarea" autofocus outlined label="답변" autogrow />
      </q-card-section>

      <q-expansion-item
        v-if="linkedDocs.length"
        label="관련 문서 참고 (이 문서가 links로 연결한 SP/DS/PL 등)"
        default-opened
        dense
        class="q-mx-md q-mb-sm"
      >
        <q-card flat bordered v-for="doc in linkedDocs" :key="doc.path" class="q-pa-sm q-mb-sm">
          <div class="text-caption text-weight-medium">{{ doc.meta.id }} · {{ doc.meta.title }}</div>
          <div class="text-caption text-grey-7" style="white-space: pre-wrap; max-height: 160px; overflow-y: auto">{{ doc.body.slice(0, 800) }}</div>
        </q-card>
      </q-expansion-item>

      <q-card-actions align="right">
        <q-btn flat label="취소" @click="emit('update:modelValue', false)" />
        <q-btn color="primary" label="답변 제출" :loading="submitting" :disable="!answer.trim()" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
