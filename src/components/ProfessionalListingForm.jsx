import {
  Box,
  Button,
  FormControl,
  TextInput,
  Textarea,
  Select,
  Checkbox,
  Text,
} from '@primer/react'
import {
  CATEGORY_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
  BRAZIL_STATES,
} from '../constants/professionalListingTaxonomy'
import StorefrontImage from './StorefrontImage'
export default function ProfessionalListingForm({
  form,
  onChange,
  onSubmit,
  onUpload,
  busy,
  communities = [],
}) {
  const field = (key, value) => onChange({ ...form, [key]: value })
  return (
    <Box as="form" onSubmit={onSubmit} sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
      <FormControl disabled={busy}>
        <FormControl.Label>Nome profissional ou comercial</FormControl.Label>
        <TextInput
          block
          maxLength={80}
          value={form.displayName || ''}
          onChange={(e) => field('displayName', e.target.value)}
        />
      </FormControl>
      <FormControl disabled={busy}>
        <FormControl.Label>Categoria</FormControl.Label>
        <Select
          block
          value={form.categoryKey || ''}
          onChange={(e) => field('categoryKey', e.target.value)}
        >
          <Select.Option value="">Selecione</Select.Option>
          {CATEGORY_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>
              {o.label}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <FormControl disabled={busy}>
        <FormControl.Label>Apresentação</FormControl.Label>
        <Textarea
          block
          rows={4}
          maxLength={1500}
          value={form.bio || ''}
          onChange={(e) => field('bio', e.target.value)}
        />
      </FormControl>
      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 100px'], gap: 3 }}>
        <FormControl disabled={busy}>
          <FormControl.Label>Cidade</FormControl.Label>
          <TextInput
            block
            maxLength={80}
            value={form.city || ''}
            onChange={(e) => field('city', e.target.value)}
          />
        </FormControl>
        <FormControl disabled={busy}>
          <FormControl.Label>Estado</FormControl.Label>
          <Select block value={form.uf || ''} onChange={(e) => field('uf', e.target.value)}>
            <Select.Option value="">UF</Select.Option>
            {BRAZIL_STATES.map((uf) => (
              <Select.Option key={uf}>{uf}</Select.Option>
            ))}
          </Select>
        </FormControl>
      </Box>
      <FormControl disabled={busy}>
        <FormControl.Label>Atendimento</FormControl.Label>
        <Select
          block
          value={form.serviceMode || 'in_person'}
          onChange={(e) => field('serviceMode', e.target.value)}
        >
          {SERVICE_MODE_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>
              {o.label}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <Box as="fieldset" sx={{ border: 0, p: 0, m: 0 }} disabled={busy}>
        <Text as="legend" sx={{ fontWeight: 'bold', mb: 2 }}>
          Modalidades (até cinco)
        </Text>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {MODALITY_OPTIONS.map((o) => (
            <FormControl key={o.value}>
              <Checkbox
                checked={(form.modalityKeys || []).includes(o.value)}
                onChange={(e) =>
                  field(
                    'modalityKeys',
                    e.target.checked
                      ? [...(form.modalityKeys || []), o.value].slice(0, 5)
                      : (form.modalityKeys || []).filter((v) => v !== o.value)
                  )
                }
              />
              <FormControl.Label>{o.label}</FormControl.Label>
            </FormControl>
          ))}
        </Box>
      </Box>
      <FormControl disabled={busy}>
        <FormControl.Label>Especialidades (separadas por vírgula)</FormControl.Label>
        <TextInput
          block
          value={form.specialtiesText || ''}
          onChange={(e) => field('specialtiesText', e.target.value)}
        />
      </FormControl>
      {form.kind === 'space' && (
        <>
          <FormControl disabled={busy}>
            <FormControl.Label>Endereço comercial público</FormControl.Label>
            <TextInput
              block
              maxLength={300}
              value={form.address || ''}
              onChange={(e) => field('address', e.target.value)}
            />
          </FormControl>
          <FormControl disabled={busy}>
            <FormControl.Label>Horários de funcionamento</FormControl.Label>
            <Textarea
              block
              maxLength={500}
              value={form.openingHours || ''}
              onChange={(e) => field('openingHours', e.target.value)}
            />
          </FormControl>
        </>
      )}
      {['whatsapp', 'instagram', 'website'].map((key) => (
        <FormControl disabled={busy} key={key}>
          <FormControl.Label>
            {key === 'website'
              ? 'Site público'
              : key === 'whatsapp'
                ? 'WhatsApp público'
                : 'Instagram público'}
          </FormControl.Label>
          <TextInput
            block
            type="url"
            value={form.contacts?.[key] || ''}
            onChange={(e) => field('contacts', { ...form.contacts, [key]: e.target.value })}
          />
          <FormControl.Caption>
            Link HTTPS. Este contato será público após aprovação.
          </FormControl.Caption>
        </FormControl>
      ))}
      <FormControl disabled={busy}>
        <FormControl.Label>Imagem principal</FormControl.Label>
        <input
          type="file"
          aria-label="Imagem principal"
          disabled={busy}
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            if (e.target.files?.[0]) onUpload(e.target.files[0])
            e.target.value = ''
          }}
        />
        <FormControl.Caption>
          A imagem enviada fica privada até aprovação. Arquivos de até 1 MB após compressão.
        </FormControl.Caption>
      </FormControl>
      {form.mediaId && (
        <Box>
          <StorefrontImage id={form.mediaId} alt="Prévia privada da imagem" />
          <Button disabled={busy} onClick={() => field('mediaId', null)}>
            Remover imagem do rascunho
          </Button>
        </Box>
      )}
      <FormControl disabled={busy}>
        <FormControl.Label>Comunidade vinculada (opcional)</FormControl.Label>
        <Select
          block
          value={form.linkedCommunityId || ''}
          onChange={(e) => field('linkedCommunityId', e.target.value)}
        >
          <Select.Option value="">Sem vínculo</Select.Option>
          {communities.map((c) => (
            <Select.Option key={c.id} value={c.id}>
              {c.name}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <Button variant="primary" type="submit" disabled={busy}>
        Salvar rascunho
      </Button>
    </Box>
  )
}
