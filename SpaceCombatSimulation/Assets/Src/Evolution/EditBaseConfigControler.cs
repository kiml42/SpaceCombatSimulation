using UnityEngine;


namespace Assets.Src.Evolution
{
    public abstract class EditBaseConfig : MonoBehaviour
    {
        public abstract void PopulateControls(EvolutionConfig config);
    }
}