using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;

namespace Assets.Src.Controllers
{
    public abstract class AbstractDeactivatableController : GeneticConfigurableMonobehaviour, IDeactivatable
    {
        protected bool _active = true;

        public virtual void Deactivate()
        {
            //Debug.Log("Deactivating " + name);
            _active = false;
        }
    }
}
