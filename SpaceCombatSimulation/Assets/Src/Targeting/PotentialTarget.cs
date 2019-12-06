using Assets.Src.Interfaces;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Class for keeping a score for a potential target
    /// </summary>
    public class PotentialTarget
    {
        public float Score { get; set; }
        public bool IsValidForCurrentPicker { get; set; }

        public ITarget Target { get; private set; }

        public PotentialTarget(Rigidbody target) : this(new Target(target))
        {
        }

        public PotentialTarget(Transform target) : this(new Target(target))
        {
        }

        public PotentialTarget(ITarget target)
        {
            Target = target;
        }
    }
}
