using Assets.Src.Interfaces;
using System.Collections.Generic;
using UnityEngine;

public class EnemyTagSource : MonoBehaviour, IKnowsEnemyTags
{
    [Tooltip("If this can find an EnemyTagSource in its parents it will use those enemy tags instead of its own.")]
    public bool DeferToParent = true;
    
    public List<string> KnownEnemyTags
    {
        get
        {
            LoadTagsFromParent();
            return EnemyTags;
        }
        set
        {
            if (DeferToParent && _parentTagSource != null)
            {
                Debug.LogWarning("Cannot set enemy tags for deffered tag knower.");
            }
            else
            {
                EnemyTags = value;
            }
        }
    }
    
    public List<string> EnemyTags;

    private IKnowsEnemyTags _parentTagSource;

    public void Start()
    {
        if (DeferToParent)
        {
            _parentTagSource = GetComponentInParent<IKnowsEnemyTags>();
        }
    }

    private void LoadTagsFromParent()
    {
        if(DeferToParent && _parentTagSource != null)
        {
            EnemyTags = _parentTagSource.KnownEnemyTags;
        }
    }
    
}
