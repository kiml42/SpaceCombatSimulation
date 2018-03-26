using Assets.Src.Targeting;
using System.Collections.Generic;

namespace Assets.Src.Interfaces
{
    public interface ITargetPicker
    {
        IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets);

        /// <summary>
        /// Target pickers are used in ascending priority order.
        /// If targets are discarded by a low priority targeter higher priority targeters won't get to judge them at all.
        /// </summary>
        float TargetPickerPriority { get; }
    }
}
