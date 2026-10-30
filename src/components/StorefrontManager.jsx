import AdminStorefrontView from './storefront/AdminStorefrontView'
import OwnerStorefrontView from './storefront/OwnerStorefrontView'

export default function StorefrontManager({ admin = false }) {
  return admin ? <AdminStorefrontView /> : <OwnerStorefrontView />
}
