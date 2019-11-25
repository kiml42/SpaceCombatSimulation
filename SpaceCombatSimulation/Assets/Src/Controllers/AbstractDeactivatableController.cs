using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
using System;
using UnityEngine;

namespace Assets.Src.Controllers
{
    public abstract class AbstractDeactivatableController : GeneticConfigurableMonobehaviour, IDeactivatable
    {
        /// <summary>
        /// Tag to set on the torquer when it is deactivated.
        /// "Unteagged" is the correct tag for untagged objects,
        /// null (default) will not untag when deactivated.
        /// </summary>
        protected const string InactiveTag = "Untagged";

        protected bool _active = true;

        public virtual void Deactivate()
        {
            Debug.Log("Deactivating " + name);
            TargetRepository.DeregisterTarget(transform);
            _active = false;
            tag = InactiveTag;
        }
    }
}
