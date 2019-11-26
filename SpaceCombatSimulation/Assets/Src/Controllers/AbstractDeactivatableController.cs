using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;

namespace Assets.Src.Controllers
{
    public abstract class AbstractDeactivatableController : GeneticConfigurableMonobehaviour, IDeactivatable
    {
        /// <summary>
        /// Tag to set on the torquer when it is deactivated.
        /// "Unteagged" is the correct tag for untagged objects,
        /// null (default) will not untag when deactivated.
        /// </summary>
        public const string InactiveTag = "Untagged";

        protected bool _active = true;

        public virtual void Deactivate()
        {
            //Debug.Log("Deactivating " + name);
            _active = false;
            tag = InactiveTag;
        }
    }
}
