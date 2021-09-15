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
        public bool IsValidForCurrentPicker { get; set; } = true;

        public ITarget Target { get; private set; }

        public PotentialTarget(Rigidbody target)
        {
            Target = target.GetComponent<ITarget>();
        }

        public PotentialTarget(Transform target)
        {
            Target = target.GetComponent<ITarget>();
        }

        public PotentialTarget(ITarget target)
        {
            Target = target;
        }

        public override string ToString()
        {
            return base.ToString() + "("+ Target + ":" + Score + ")";
        }
    }
}
